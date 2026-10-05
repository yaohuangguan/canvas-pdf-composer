export function installDownloadBridge() {
  if (window.__canvasCoursePdfBridgeInstalled) return;
  window.__canvasCoursePdfBridgeInstalled = true;

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'pdf-composer') return;
    if (data.action !== 'download-review-pdf' && data.action !== 'capture-canvas-resource') return;

    chrome.runtime.sendMessage(data, (response) => {
      const lastError = chrome.runtime.lastError;
      window.postMessage({
        source: 'pdf-composer',
        action: data.action === 'capture-canvas-resource' ? 'capture-resource-result' : 'pdf-result',
        exportId: data.exportId,
        requestId: data.requestId,
        ok: !lastError && !!response?.ok,
        error: lastError?.message || response?.error || null,
        extraPages: response?.extraPages || 0
      }, '*');
    });
  });
}

export async function collectCanvasCourse(options) {
  const courseMatch = location.pathname.match(/\/courses\/(\d+)/);
  if (!courseMatch) {
    alert('Open the Canvas course Modules page first.');
    return {ok: false, message: 'This does not look like a Canvas course page.'};
  }

  const courseId = courseMatch[1];
  const exportId = courseId + '-' + Date.now();
  const output = window.open('', '_blank');
  if (!output) {
    alert('Canvas exporter needs permission to open one new tab. Allow pop-ups for this page and try again.');
    return {ok: false, message: 'Pop-up blocked.'};
  }

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const safeId = (value = '') => 'x-' + String(value)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const showProgress = (message) => {
    try {
      output.document.open();
      output.document.write(`<!doctype html><meta charset="utf-8"><title>Building review…</title>
        <style>body{font-family:system-ui;margin:0;background:#f6f8fb;color:#17202a}
        .box{max-width:720px;margin:12vh auto;padding:32px;background:white;border:1px solid #dfe4ea;border-radius:16px}
        h1{font-size:24px;margin-top:0}.muted{color:#66717e;line-height:1.6}</style>
        <div class="box"><h1>Building your course review</h1><div class="muted">${escapeHtml(message)}</div></div>`);
      output.document.close();
    } catch {}
  };

  showProgress('Reading course modules…');

  async function fetchJson(url) {
    const response = await fetch(url, {credentials: 'include'});
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
    return response.json();
  }

  async function fetchPaged(url) {
    const all = [];
    let next = url;
    let guard = 0;

    while (next && guard++ < 50) {
      const response = await fetch(next, {credentials: 'include'});
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${next}`);
      const data = await response.json();
      if (Array.isArray(data)) all.push(...data);
      else all.push(data);

      const link = response.headers.get('Link') || '';
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      next = match ? match[1] : null;
    }
    return all;
  }

  function shouldInclude(type) {
    if (type === 'Page') return options.pages;
    if (type === 'Discussion') return options.discussions;
    if (type === 'Assignment') return options.assignments;
    if (type === 'Quiz') return options.quizzes;
    if (type === 'File' || type === 'ExternalUrl' || type === 'ExternalTool') return options.files;
    return false;
  }

  function normalizeBody(rawHtml, baseUrl) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = rawHtml || '';

    wrapper.querySelectorAll('script,noscript').forEach(el => el.remove());

    wrapper.querySelectorAll('img').forEach(img => {
      const lazy = img.getAttribute('data-src') || img.getAttribute('data-api-endpoint');
      if (!img.getAttribute('src') && lazy) img.setAttribute('src', lazy);
      const src = img.getAttribute('src');
      if (src) {
        try { img.setAttribute('src', new URL(src, baseUrl).href); } catch {}
      }
      img.removeAttribute('loading');
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    });

    wrapper.querySelectorAll('a[href]').forEach(a => {
      try { a.href = new URL(a.getAttribute('href'), baseUrl).href; } catch {}
    });

    wrapper.querySelectorAll('iframe').forEach(frame => {
      const src = frame.getAttribute('src');
      if (!src) return;
      let href = src;
      try { href = new URL(src, baseUrl).href; } catch {}
      const replacement = document.createElement('p');
      replacement.className = 'embedded-link';
      replacement.innerHTML = '<strong>Embedded content:</strong> <a href="' +
        escapeHtml(href) + '">' + escapeHtml(href) + '</a>';
      frame.replaceWith(replacement);
    });

    return wrapper.innerHTML;
  }

  async function captureResource(item, targetUrl, title, kind = 'page') {
    if (!targetUrl) return {ok: false, error: 'No resource URL available.'};
    const requestId = exportId + '-' + item.id + '-' + Math.random().toString(36).slice(2);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onResult);
        resolve({ok: false, error: 'Timed out while capturing this resource.'});
      }, 30_000);

      function onResult(event) {
        const data = event.data;
        if (!data || data.source !== 'pdf-composer' || data.action !== 'capture-resource-result' || data.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', onResult);
        resolve({ok: !!data.ok, error: data.error || null});
      }

      window.addEventListener('message', onResult);
      window.postMessage({
        source: 'pdf-composer',
        action: 'capture-canvas-resource',
        exportId,
        requestId,
        url: targetUrl,
        title: title || item.title || item.type,
        itemType: item.type,
        kind
      }, '*');
    });
  }

  function googleSlidesPdfUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const match = parsed.pathname.match(/\/presentation\/d\/([^/]+)/);
      if (!/\.google\.com$/i.test(parsed.hostname) || !match) return null;
      return `${parsed.origin}/presentation/d/${match[1]}/export/pdf`;
    } catch {
      return null;
    }
  }

  async function loadItem(item) {
    const fallbackUrl = item.html_url || item.external_url || location.href;

    if (item.type === 'File' || item.type === 'ExternalUrl' || item.type === 'ExternalTool') {
      let targetUrl = item.external_url || item.html_url || fallbackUrl;
      let resourceName = item.title || item.type;
      let kind = 'page';
      let resourceType = item.type;

      if (item.type === 'File' && item.url) {
        try {
          const detail = await fetchJson(item.url);
          resourceName = detail.display_name || detail.filename || resourceName;
          resourceType = detail['content-type'] || detail.content_type || resourceType;
          const lowerName = resourceName.toLowerCase();
          const isPdf = String(resourceType).toLowerCase().includes('pdf') || lowerName.endsWith('.pdf');

          if (isPdf && detail.url) {
            targetUrl = detail.url;
            kind = 'pdf-url';
          } else {
            // Canvas commonly exposes an authenticated preview URL for Office documents.
            targetUrl = detail.preview_url || item.html_url || detail.url || targetUrl;
            kind = detail.preview_url ? 'page' : 'page';
          }
        } catch {}
      }

      const slidesPdf = googleSlidesPdfUrl(targetUrl);
      if (slidesPdf) {
        targetUrl = slidesPdf;
        kind = 'pdf-url';
        resourceType = 'Google Slides';
      }

      showProgress(`Capturing resource: ${resourceName}`);
      const captured = await captureResource(item, targetUrl, resourceName, kind);

      return {
        html: captured.ok
          ? '<div class="resource-link"><strong>Included in exported PDF:</strong> ' +
              escapeHtml(resourceName) + '<br><span class="resource-meta">' +
              escapeHtml(resourceType) + ' · appended after the course review in module order</span></div>'
          : '<div class="warning"><strong>Could not capture this resource automatically.</strong><br>' +
              escapeHtml(captured.error || 'Unknown capture error') + '<br><a href="' +
              escapeHtml(fallbackUrl) + '">Open resource in Canvas</a></div>',
        sourceUrl: fallbackUrl,
        failed: !captured.ok
      };
    }

    if (item.url) {
      try {
        const detail = await fetchJson(item.url);
        const body = detail.body ?? detail.message ?? detail.description ?? '';
        if (body) return {html: normalizeBody(body, fallbackUrl), sourceUrl: fallbackUrl};
      } catch {}
    }

    if (item.html_url) {
      try {
        const response = await fetch(item.html_url, {credentials: 'include'});
        if (response.ok) {
          const html = await response.text();
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          const main = parsed.querySelector('.show-content, .user_content, #wiki_page_show .content, main .content, #content');
          if (main) return {html: normalizeBody(main.innerHTML, item.html_url), sourceUrl: item.html_url};
        }
      } catch {}
    }

    return {
      html: '<p class="warning">This item could not be extracted automatically. ' +
        (item.html_url ? '<a href="' + escapeHtml(item.html_url) + '">Open it in Canvas</a>.' : '') +
        '</p>',
      sourceUrl: fallbackUrl,
      failed: true
    };
  }

  try {
    const course = await fetchJson(location.origin + '/api/v1/courses/' + courseId);
    const modules = await fetchPaged(
      location.origin + '/api/v1/courses/' + courseId + '/modules?per_page=100'
    );

    modules.sort((a, b) => (a.position || 0) - (b.position || 0));

    const sections = [];
    const toc = [];
    const failures = [];
    let includedCount = 0;

    for (let m = 0; m < modules.length; m++) {
      const mod = modules[m];
      showProgress(`Module ${m + 1} of ${modules.length}: ${mod.name || 'Untitled'}`);

      const items = await fetchPaged(
        location.origin + '/api/v1/courses/' + courseId +
        '/modules/' + mod.id + '/items?per_page=100'
      );

      items.sort((a, b) => (a.position || 0) - (b.position || 0));
      const moduleId = safeId('module-' + mod.id + '-' + mod.name);
      const moduleParts = [];
      const moduleToc = [];

      for (const item of items) {
        if (!shouldInclude(item.type)) continue;
        includedCount++;
        showProgress(
          `Module ${m + 1}/${modules.length} · Item ${includedCount}: ${item.title || item.type}`
        );

        const itemId = safeId('item-' + item.id + '-' + item.title);
        const loaded = await loadItem(item);
        if (loaded.failed) failures.push(item.title || ('Item ' + item.id));

        moduleToc.push({
          id: itemId,
          title: item.title || item.type,
          type: item.type
        });

        moduleParts.push(`
          <section class="course-item" id="${itemId}">
            <div class="item-kicker">${escapeHtml(item.type)}</div>
            <h2>${escapeHtml(item.title || 'Untitled')}</h2>
            <div class="item-body">${loaded.html}</div>
            <div class="source"><a href="${escapeHtml(loaded.sourceUrl)}">View original in Canvas</a></div>
          </section>
        `);
      }

      if (moduleParts.length) {
        toc.push({id: moduleId, title: mod.name || ('Module ' + (m + 1)), items: moduleToc});
        sections.push(`
          <section class="module" id="${moduleId}">
            <header class="module-header">
              <div class="module-number">MODULE ${m + 1}</div>
              <h1>${escapeHtml(mod.name || ('Module ' + (m + 1)))}</h1>
            </header>
            ${moduleParts.join('')}
          </section>
        `);
      }
    }

    const tocHtml = toc.map(mod => `
      <li class="toc-module">
        <a href="#${mod.id}">${escapeHtml(mod.title)}</a>
        <ul>${mod.items.map(item =>
          '<li><a href="#' + item.id + '">' + escapeHtml(item.title) +
          '</a><span>' + escapeHtml(item.type) + '</span></li>'
        ).join('')}</ul>
      </li>
    `).join('');

    const warningHtml = failures.length ? `
      <div class="export-warning">
        <strong>${failures.length} item(s) could not be fully extracted.</strong>
        Links to the original Canvas items are included in their place.
      </div>` : '';

    const finalHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base href="${escapeHtml(location.origin + '/')}">
<title>${escapeHtml(course.name || document.title)} — Complete Review [${exportId}]</title>
<style>
  :root{--ink:#18212b;--muted:#64707d;--line:#d9e0e7;--soft:#f5f7f9;--accent:#245ea8}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;color:var(--ink);font:15px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:#eef2f5}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  .toolbar{position:sticky;top:0;z-index:50;display:flex;gap:10px;align-items:center;padding:10px 18px;background:#101820;color:white;box-shadow:0 2px 8px #0002}
  .toolbar button{border:0;border-radius:8px;background:white;color:#101820;font-weight:700;padding:9px 14px;cursor:pointer}
  .toolbar button.primary{background:#2f80ed;color:white}
  .toolbar button:disabled{opacity:.55;cursor:default}
  .toolbar .hint{font-size:12px;opacity:.75}
  .paper{max-width:980px;margin:28px auto;background:white;box-shadow:0 5px 28px #20304020}
  .cover{min-height:78vh;padding:12vh 72px 60px;display:flex;flex-direction:column;justify-content:center}
  .cover .eyebrow{font-weight:800;letter-spacing:.12em;color:var(--accent);font-size:12px}
  .cover h1{font-size:42px;line-height:1.1;margin:12px 0 18px}
  .cover p{font-size:17px;color:var(--muted);max-width:700px}
  .toc{padding:52px 72px;border-top:1px solid var(--line)}
  .toc h1{font-size:30px;margin-top:0}
  .toc ol{padding-left:22px}
  .toc-module{margin:15px 0;font-weight:700}
  .toc-module ul{padding-left:24px;margin:6px 0 0;font-weight:400}
  .toc-module li{margin:4px 0}
  .toc-module span{margin-left:8px;color:var(--muted);font-size:11px;text-transform:uppercase}
  .module{padding:0 72px 58px}
  .module-header{padding-top:50px;margin-bottom:25px;border-top:4px solid var(--ink)}
  .module-number{font-weight:800;letter-spacing:.13em;font-size:11px;color:var(--accent)}
  .module-header h1{font-size:34px;line-height:1.16;margin:8px 0}
  .course-item{padding:34px 0 42px;border-top:1px solid var(--line)}
  .item-kicker{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .course-item h2{font-size:25px;line-height:1.24;margin:7px 0 22px}
  .item-body img{max-width:100%!important;height:auto!important}
  .item-body table{width:100%;border-collapse:collapse;display:table!important;overflow:visible!important}
  .item-body th,.item-body td{border:1px solid #cfd6dd;padding:7px 9px;vertical-align:top}
  .item-body pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f8fa;padding:12px;border-radius:6px}
  .item-body blockquote{margin-left:0;border-left:4px solid #ccd6e0;padding-left:16px;color:#4c5966}
  .source{margin-top:22px;padding-top:9px;border-top:1px dashed var(--line);font-size:11px;color:var(--muted)}
  .resource-link,.embedded-link{padding:12px 14px;border:1px solid var(--line);background:var(--soft);border-radius:8px}
  .warning,.export-warning{padding:12px 14px;border:1px solid #e0b35f;background:#fff8e8;border-radius:8px}
  .export-warning{margin:0 72px 36px}
  @media print{
    @page{size:A4;margin:10mm}
    html,body{
      background:white!important;
      -webkit-print-color-adjust:exact;
      print-color-adjust:exact;
    }
    body{
      margin:0!important;
      font-size:11pt;
      line-height:1.58;
    }
    .toolbar{display:none!important}
    .paper{
      width:auto!important;
      max-width:none!important;
      margin:0!important;
      box-shadow:none!important;
      background:white!important;
    }
    .cover{
      min-height:245mm;
      padding:30mm 14mm 20mm;
      break-after:page;
      page-break-after:always;
    }
    .cover h1{font-size:32pt}
    .toc{
      padding:14mm 14mm 10mm;
      border:0;
      break-after:page;
      page-break-after:always;
    }
    .module{
      padding:0 14mm 14mm;
    }
    .module-header{
      padding-top:10mm;
      margin-bottom:8mm;
      break-before:page;
      page-break-before:always;
    }
    .module:first-of-type .module-header{
      break-before:auto;
      page-break-before:auto;
    }
    .course-item{
      padding:8mm 0 10mm;
      break-before:auto!important;
      page-break-before:auto!important;
      break-inside:auto;
      page-break-inside:auto;
    }
    .course-item h2{
      font-size:18pt;
      margin:3mm 0 6mm;
      break-after:avoid;
      page-break-after:avoid;
    }
    h1,h2,h3,h4{
      break-after:avoid;
      page-break-after:avoid;
    }
    p,li,blockquote{
      orphans:3;
      widows:3;
    }
    img,figure,table,pre,blockquote{
      max-width:100%!important;
      break-inside:avoid;
      page-break-inside:avoid;
    }
    table{
      font-size:9.5pt;
    }
    pre{
      white-space:pre-wrap!important;
      overflow-wrap:anywhere!important;
    }
    .item-body{
      overflow:visible!important;
    }
    .item-body *{
      max-width:100%;
    }
    .source{
      font-size:8pt;
      margin-top:5mm;
    }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button id="downloadBtn" class="primary">Download PDF</button>
    <button id="printBtn">Print</button>
    <span class="hint">${includedCount} items · ${modules.length} modules · course review + captured files, slides and links</span>
  </div>
  <main class="paper">
    <section class="cover">
      <div class="eyebrow">CANVAS PDF COMPOSER</div>
      <h1>${escapeHtml(course.name || 'Course Review')}</h1>
      <p>Combined automatically from the course Modules structure on ${escapeHtml(new Date().toLocaleString())}.</p>
      <p>${includedCount} included items across ${toc.length} modules.</p>
    </section>
    <section class="toc">
      <h1>Contents</h1>
      <ol>${tocHtml}</ol>
    </section>
    ${warningHtml}
    ${sections.join('')}
  </main>
</body>
</html>`;

    output.document.open();
    output.document.write(finalHtml);
    output.document.close();

    const printButton = output.document.getElementById('printBtn');
    if (printButton) printButton.addEventListener('click', () => output.print());

    const downloadButton = output.document.getElementById('downloadBtn');
    if (downloadButton) {
      downloadButton.addEventListener('click', () => {
        downloadButton.disabled = true;
        downloadButton.textContent = 'Preparing PDF…';
        window.postMessage({
          source: 'pdf-composer',
          action: 'download-review-pdf',
          exportId,
          title: output.document.title,
          filename: (course.name || 'Course Review') + ' - Complete Review.pdf'
        }, '*');
      });
    }

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.source !== 'pdf-composer' ||
          data.action !== 'pdf-result' || data.exportId !== exportId) return;

      if (downloadButton) {
        downloadButton.disabled = false;
        downloadButton.textContent = data.ok ? 'Download PDF' : 'Download failed - retry';
        downloadButton.title = data.error || '';
      }
    });

    output.focus();

    return {
      ok: true,
      message: `Done: ${includedCount} items from ${toc.length} modules. Use “Download PDF” in the new tab.`
    };
  } catch (error) {
    output.document.open();
    output.document.write(
      '<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui;padding:40px;max-width:800px;margin:auto}</style>' +
      '<h1>Export failed</h1><pre>' + escapeHtml(error?.stack || error?.message || String(error)) + '</pre>'
    );
    output.document.close();
    return {ok: false, message: 'Export failed: ' + (error?.message || String(error))};
  }
}