#!/usr/bin/env node
/**
 * Privacy-Sanitized Showcase Server (`assets/showcase/showcase-server.mjs`)
 *
 * Zero-dependency local Node HTTP server (`127.0.0.1:0`) powering deterministic
 * promo video & cover rendering for `agy-wallpaper-prism`:
 *
 *   - `GET /studio`     -> Real built `agy-wallpaper-prism` Sidecar Studio UI wired to
 *                          sanitized SFW `/api/*` endpoints (live state + live autostart toggle).
 *   - `GET /hub`        -> Hyper-accurate, 100% privacy-sanitized Antigravity 2.0 Hub
 *                          (`body.dark` / `body.light` Tailwind tokens, clean workspaces,
 *                          syntax-highlighted code, xterm terminal card, Neko HUD & CTX 18%)
 *                          running the REAL `wallpaper-inject.js` + `panel-inject.js`
 *                          wired to mock `window.__agyPrismCall` + SSE live sync +
 *                          deterministic 60fps canvas frame driver (`window.__showcaseHub`).
 *                          Supports query flags: `?theme=dark|light`, `?skin=0|1`,
 *                          `?aux=telemetry|studio`, `?frameMode=canvas|video`.
 *   - `GET /media/*`    -> Serves `honkai3-hero.mp4`, `honkai3-poster.png`,
 *                          `honkai3-frame-*.png`, `honkai3-frames/%04d.jpg`, and sanitized
 *                          `thumbs/*` with CORS & full HTTP `206` Range / `416` / `HEAD`.
 *   - `GET /host/*`     -> Serves the REAL `wallpaper-inject.js` and `panel-inject.js`.
 *   - `GET /scene/*`    -> Read-only static serving of `scene/` (same-origin for video capture).
 *   - `GET /audio/*`    -> Read-only static serving of `audio/` (`timeline.json`, `bgm-energy.json`).
 */

import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = __dirname;
const INTRO_ROOT = resolve(__dirname, '..', '..');
const PLUGIN_ROOT = resolve(INTRO_ROOT, '..', 'agy-wallpaper-prism');
const STUDIO_HTML_PATH = join(PLUGIN_ROOT, 'sidecars', 'prism_studio', 'index.html');
const WALLPAPER_INJECT_PATH = join(PLUGIN_ROOT, 'src', 'host', 'wallpaper-inject.js');
const PANEL_INJECT_PATH = join(PLUGIN_ROOT, 'src', 'host', 'panel-inject.js');
const LIBRARY_JSON_PATH = join(SHOWCASE_DIR, 'library.json');

const schemaMod = await import(pathToFileURL(join(PLUGIN_ROOT, 'src', 'shared', 'schema.mjs')).href);
const hostMod = await import(pathToFileURL(join(PLUGIN_ROOT, 'src', 'host', 'index.mjs')).href);

const {
  DEFAULT_CONFIG,
  DEFAULT_DEBUG_PORT,
  FACTORY_PRESETS,
  PLUGIN_VERSION,
  RESET_SCOPES,
  SCENE_PRESETS,
  SCENE_PRESET_IDS,
  SIDECAR_URI,
  resolveEffectiveConfig,
  sanitizeConfig,
} = schemaMod;
const { buildClientSkinPayload } = hostMod;

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
});

const SANITIZED_VIRTUAL_DIRS = Object.freeze({
  '': {
    current: '~/Pictures/wallpapers',
    parent: '~',
    dirs: [
      { name: 'wallpapers', path: '~/Pictures/wallpapers' },
      { name: 'Steam Library (431960)', path: 'Steam/steamapps/workshop/content/431960' },
      { name: '.agy-wallpaper-prism', path: '~/.agy-wallpaper-prism' },
    ],
  },
  '~': {
    current: '~',
    parent: '',
    dirs: [
      { name: 'Pictures', path: '~/Pictures' },
      { name: '.agy-wallpaper-prism', path: '~/.agy-wallpaper-prism' },
    ],
  },
  '~/Pictures': {
    current: '~/Pictures',
    parent: '~',
    dirs: [{ name: 'wallpapers', path: '~/Pictures/wallpapers' }],
  },
  '~/Pictures/wallpapers': {
    current: '~/Pictures/wallpapers',
    parent: '~/Pictures',
    dirs: [
      { name: '4K-Dynamic', path: '~/Pictures/wallpapers/4K-Dynamic' },
      { name: 'Prism-Curated', path: '~/Pictures/wallpapers/Prism-Curated' },
    ],
  },
  'Steam/steamapps/workshop/content/431960': {
    current: 'Steam/steamapps/workshop/content/431960',
    parent: '',
    dirs: [
      { name: '2876797752 (崩坏3周年庆（动态）)', path: 'Steam/steamapps/workshop/content/431960/2876797752' },
      { name: '3008666979 (星空と少女)', path: 'Steam/steamapps/workshop/content/431960/3008666979' },
      { name: '884307090 (完美壁纸)', path: 'Steam/steamapps/workshop/content/431960/884307090' },
    ],
  },
  '~/.agy-wallpaper-prism': {
    current: '~/.agy-wallpaper-prism',
    parent: '~',
    dirs: [
      { name: 'cache', path: '~/.agy-wallpaper-prism/cache' },
      { name: 'uploads', path: '~/.agy-wallpaper-prism/uploads' },
    ],
  },
});

const STUDIO_PRELOAD_SHIM_JS = `(function() {
  var params = new URLSearchParams(window.location.search);
  var boot = window.__SIDECAR_BOOT__ || {};
  var token = params.get('token') || boot.token || '';
  var conversationId = params.get('conversationId') || boot.conversationId || 'showcase-demo';
  var workspaceUris = ['file:///workspace/agy-wallpaper-prism', 'file:///workspace/obsidian-prism-theme'];
  var wsListeners = new Set();

  window.addEventListener('message', function(event) {
    if (!event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'theme-change') {
      var vars = (event.data.payload && event.data.payload.cssVariables) || {};
      Object.keys(vars).forEach(function(k) {
        document.documentElement.style.setProperty(k, vars[k]);
      });
      window.dispatchEvent(new CustomEvent('prism-host-theme', { detail: vars }));
    } else if (event.data.type === 'prism-theme-sync') {
      window.dispatchEvent(new CustomEvent('prism-theme-sync', { detail: event.data.payload || {} }));
    } else if (event.data.type === 'workspace-change') {
      var list = (event.data.payload && event.data.payload.workspaceUris) || [];
      workspaceUris = Array.isArray(list) ? list.slice() : [];
      wsListeners.forEach(function(fn) { try { fn(workspaceUris.slice()); } catch (_) {} });
    } else if (event.data.type === 'showcase-frame') {
      if (window.__showcaseStudio && typeof window.__showcaseStudio.setVideoFrame === 'function') {
        window.__showcaseStudio.setVideoFrame(event.data.frameIdx, event.data.frameUrl);
      }
    }
  });

  function secureFetch(url, options) {
    var init = Object.assign({}, options || {});
    var headers = new Headers(init.headers || {});
    if (token) headers.set('X-Sidecar-Token', token);
    if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    init.headers = headers;
    return window.fetch(url, init);
  }

  if (!window.sidecar) {
    window.sidecar = {
      conversationId: conversationId,
      fetch: secureFetch,
      getWorkspaceUris: function() { return Promise.resolve(workspaceUris.slice()); },
      onWorkspaceChange: function(fn) {
        if (typeof fn !== 'function') return function() {};
        wsListeners.add(fn);
        return function() { wsListeners.delete(fn); };
      },
      ui: {
        toggleAuxPane: function(req) {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'toggle-aux-pane', payload: req || {} }, '*');
          }
        }
      }
    };
  }

  // Deterministic preview frame helper for Studio mini-stage video capture
  var frameCache = new Map();
  function loadFrameImg(url) {
    if (frameCache.has(url)) return Promise.resolve(frameCache.get(url));
    return new Promise(function(resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function() {
        if (frameCache.size > 90) {
          var firstKey = frameCache.keys().next().value;
          frameCache.delete(firstKey);
        }
        frameCache.set(url, img);
        resolve(img);
      };
      img.onerror = function() { resolve(null); };
      img.src = url;
    });
  }

  window.__showcaseStudio = {
    setVideoFrame: function(frameIdx, explicitUrl) {
      var url = explicitUrl || ('/media/honkai3-frames/' + String(Math.max(0, Number(frameIdx) || 0)).padStart(4, '0') + '.jpg');
      var previewVideo = document.querySelector('video');
      if (!previewVideo || !previewVideo.parentElement) return Promise.resolve(false);
      var parent = previewVideo.parentElement;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      var cvs = parent.querySelector('#studio-showcase-frame-canvas');
      if (!cvs) {
        cvs = document.createElement('canvas');
        cvs.id = 'studio-showcase-frame-canvas';
        cvs.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;z-index:2;border-radius:inherit;';
        parent.appendChild(cvs);
      }
      try { previewVideo.pause(); } catch (_) {}
      return loadFrameImg(url).then(function(img) {
        if (!img) return false;
        var rect = parent.getBoundingClientRect();
        var cw = Math.max(2, Math.round(rect.width || 320));
        var ch = Math.max(2, Math.round(rect.height || 180));
        if (cvs.width !== cw || cvs.height !== ch) {
          cvs.width = cw;
          cvs.height = ch;
        }
        var ctx = cvs.getContext('2d');
        if (!ctx) return false;
        var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
        var dw = img.naturalWidth * scale;
        var dh = img.naturalHeight * scale;
        ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        return true;
      });
    },
    clearVideoFrame: function() {
      var cvs = document.getElementById('studio-showcase-frame-canvas');
      if (cvs) cvs.remove();
    }
  };
})();`;

function loadSanitizedLibrary() {
  if (!existsSync(LIBRARY_JSON_PATH)) {
    throw new Error('assets/showcase/library.json not found. Run scripts/prepare-assets.mjs first.');
  }
  return JSON.parse(readFileSync(LIBRARY_JSON_PATH, 'utf8'));
}

function resolveFencedFile(rootDir, relPath) {
  const cleaned = String(relPath || '')
    .split('?')[0]
    .replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('\0') || cleaned.includes('..')) return null;
  const absRoot = resolve(rootDir);
  if (!existsSync(absRoot)) return null;
  const candidate = resolve(absRoot, cleaned);
  const rel = relative(absRoot, candidate);
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  if (!existsSync(candidate)) return null;
  try {
    const lst = lstatSync(candidate);
    if (!lst.isFile() || lst.isSymbolicLink()) return null;
    const realRoot = realpathSync(absRoot);
    const realCand = realpathSync(candidate);
    if (realCand !== realRoot && !realCand.startsWith(realRoot + sep)) return null;
    return realCand;
  } catch {
    return null;
  }
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (total === 0) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function serveStaticFileWithRange(req, res, filePath, { cacheControl = 'public, max-age=3600' } = {}) {
  const st = statSync(filePath);
  const total = st.size;
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': String(total) });
    res.end();
    return;
  }

  const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range.trim() : '';
  if (rangeHeader && rangeHeader.startsWith('bytes=')) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    let start = match[1] ? Number.parseInt(match[1], 10) : 0;
    let end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
    if (!match[1] && match[2]) {
      const suffix = Number.parseInt(match[2], 10);
      start = Math.max(0, total - suffix);
      end = total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || end < start) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    end = Math.min(end, total - 1);
    const chunkLen = end - start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(chunkLen),
    });
    if (res._isInject) {
      const buf = readFileSync(filePath).subarray(start, end + 1);
      res.end(buf);
    } else {
      createReadStream(filePath, { start, end }).pipe(res);
    }
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': String(total) });
  if (res._isInject) {
    res.end(readFileSync(filePath));
  } else {
    createReadStream(filePath).pipe(res);
  }
}

/**
 * Build the hyper-accurate, 100% privacy-sanitized Antigravity 2.0 Hub HTML.
 * Mirrors verified Antigravity 2.0 Hub Tailwind DOM & specificity (`body.dark` / `body.light` at `0,1,1`)
 * and boots the REAL `wallpaper-inject.js` + `panel-inject.js` wired to `/api/rpc` and `/api/events`.
 */
function buildSanitizedShowcaseHubHtml({
  initialTheme = 'dark',
  auxMode = 'telemetry',
  frameMode = 'video',
  initialSkinPayload,
  initialCanonicalState,
  honkaiFramesMeta,
}) {
  const themeClass = initialTheme === 'light' ? 'light' : 'dark';
  const auxSlotHtml =
    auxMode === 'studio'
      ? `<aside class="hub-aux-pane hub-aux-studio" data-testid="sidecar-iframe-slot">
          <iframe id="hub-studio-iframe" src="/studio" title="Wallpaper Prism Studio" style="width:100%;height:100%;border:0;display:block;border-radius:inherit;background:transparent;"></iframe>
        </aside>`
      : `<aside class="hub-aux-pane" data-testid="sidecar-iframe-slot">
          <div class="nav-section-label">Wallpaper Prism · 光学引擎</div>
          <div class="aux-card">
            <div style="font-weight:600;display:flex;align-items:center;justify-content:space-between;">
              <span>6 层棱镜毛玻璃层级</span>
              <span class="mini-pill">Obsidian Prism</span>
            </div>
            <div class="aux-kv"><span>窗口背景画布</span><span>镂空透出 (0.00)</span></div>
            <div class="aux-kv"><span>侧边栏浮岛</span><span>8px 间距 · 16px 模糊</span></div>
            <div class="aux-kv"><span>对话主舞台</span><span>柔光暗角护眼罩</span></div>
            <div class="aux-kv"><span>代码与终端</span><span>WCAG 对比度锁 &ge; 0.72</span></div>
          </div>
          <div class="aux-card">
            <div style="font-weight:600;display:flex;align-items:center;justify-content:space-between;">
              <span>Steam 创意工坊直连</span>
              <span class="mini-pill ok">431960</span>
            </div>
            <div class="aux-kv"><span>冷启动索引</span><span>8.3 ms 缓存命中</span></div>
            <div class="aux-kv"><span>壁纸切换</span><span>2.5 ms 零阻塞</span></div>
            <div class="aux-kv"><span>流式播放</span><span>虚拟 moov-first 206</span></div>
            <div class="aux-kv"><span>安全边界</span><span>零修改 app.asar · 0 Token</span></div>
          </div>
          <div class="aux-card">
            <div style="font-weight:600">当前激活壁纸</div>
            <div id="aux-active-title" style="opacity:0.92;font-weight:500">崩坏3周年庆（动态）</div>
            <div id="aux-active-meta" style="opacity:0.68;font-size:11px">3840×2160 · 60fps · Steam Workshop</div>
            <div class="accent-bar-row">
              <span class="accent-dot" style="background:#7FA6F8"></span>
              <span class="accent-dot" style="background:#A58AF8"></span>
              <span class="accent-dot" style="background:#88C0D0"></span>
              <span style="opacity:0.65;font-size:10.5px;margin-left:auto">32×32 动态取色</span>
            </div>
          </div>
        </aside>`;

  const bootDataJson = JSON.stringify({
    initialSkinPayload,
    initialCanonicalState,
    honkaiFramesMeta,
    frameMode,
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh-CN" class="${themeClass}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Antigravity 2.0 — agy-wallpaper-prism</title>
  <style id="antigravity-native-tokens">
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      -webkit-font-smoothing: antialiased;
    }

    /* Specificity (0,1,1) — exact Antigravity 2.0 Hub Tailwind cascade tokens */
    body.dark {
      --background: #070708;
      --body-background: #070708;
      --shell: #070708;
      --foreground: #f4f5f8;
      --card: #131317;
      --card-border: rgba(255, 255, 255, 0.08);
      --sidebar: #111114;
      --sidebar-muted: rgba(255, 255, 255, 0.04);
      --sidebar-secondary: rgba(255, 255, 255, 0.07);
      --popover: #16161c;
      --border: rgba(255, 255, 255, 0.07);
      --primary: #2f71e3;
      --primary-foreground: #ffffff;
      --link: #7fa6f8;
      background-color: var(--background);
      color: var(--foreground);
    }

    body.light {
      --background: #f5f7fb;
      --body-background: #f5f7fb;
      --shell: #f5f7fb;
      --foreground: #0f172a;
      --card: #ffffff;
      --card-border: rgba(15, 23, 42, 0.09);
      --sidebar: #eceff4;
      --sidebar-muted: rgba(15, 23, 42, 0.04);
      --sidebar-secondary: rgba(15, 23, 42, 0.07);
      --popover: #ffffff;
      --border: rgba(15, 23, 42, 0.08);
      --primary: #2563eb;
      --primary-foreground: #ffffff;
      --link: #1d4ed8;
      background-color: var(--background);
      color: var(--foreground);
    }

    #root, #root > div, #root > div > div {
      width: 100%;
      height: 100%;
      background-color: var(--background);
    }

    .bg-background { background-color: var(--background); }
    .bg-sidebar { background-color: var(--sidebar); }
    .bg-card { background-color: var(--card); border: 1px solid var(--card-border); }
    .bg-popover { background-color: var(--popover); }

    .agy-shell {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background-color: var(--shell);
    }

    [data-testid="title-menu-bar"] {
      height: 38px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      background-color: var(--sidebar);
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      user-select: none;
    }

    .hub-title-left { display: flex; align-items: center; gap: 9px; font-weight: 600; letter-spacing: 0.01em; }
    .hub-logo-gem {
      width: 16px;
      height: 16px;
      border-radius: 5px;
      background: linear-gradient(135deg, #669df6 0%, #a58af8 52%, #50e3c2 100%);
      box-shadow: 0 0 12px rgba(102, 157, 246, 0.48);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: #fff;
    }
    .hub-badge {
      padding: 2px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(127, 166, 248, 0.16);
      color: #9dc0ff;
      border: 1px solid rgba(127, 166, 248, 0.34);
    }
    body.light .hub-badge {
      background: rgba(37, 99, 235, 0.10);
      color: #1d4ed8;
      border-color: rgba(37, 99, 235, 0.28);
    }

    [data-testid="sidebar-split"] {
      display: flex;
      flex: 1;
      min-height: 0;
      width: 100%;
    }

    .agy-sidebar {
      width: 240px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      padding: 12px;
      gap: 14px;
      background-color: var(--sidebar);
    }

    .split-gutter {
      width: 1px;
      flex-shrink: 0;
      background-color: var(--border);
      cursor: col-resize;
    }

    [data-testid="aux-pane-split"] {
      display: flex;
      flex: 1;
      min-width: 0;
      min-height: 0;
    }

    .hub-main-pane {
      flex: 1;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background-color: var(--background);
    }

    [data-testid="conversation-view"] {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 22px 32px 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .nav-section-label {
      font-size: 10.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.56;
      padding: 0 7px;
      margin-bottom: 5px;
    }
    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 12.5px;
      opacity: 0.86;
      margin-bottom: 2px;
    }
    .nav-item.active {
      background: rgba(127, 166, 248, 0.16);
      border: 1px solid rgba(127, 166, 248, 0.34);
      opacity: 1;
      font-weight: 600;
    }
    body.light .nav-item.active {
      background: rgba(37, 99, 235, 0.10);
      border-color: rgba(37, 99, 235, 0.28);
    }
    .dot-online {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #50a37b;
      box-shadow: 0 0 8px rgba(80, 163, 123, 0.65);
    }

    .msg-user {
      align-self: flex-end;
      max-width: 78%;
      padding: 11px 16px;
      border-radius: 13px;
      line-height: 1.55;
      font-size: 13px;
    }
    .msg-agent {
      display: flex;
      flex-direction: column;
      gap: 11px;
      max-width: 94%;
      line-height: 1.58;
      font-size: 13px;
    }
    .msg-agent-head {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 12.5px;
    }
    .agent-pill {
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 600;
      background: rgba(165, 138, 248, 0.16);
      color: #c4b5fd;
      border: 1px solid rgba(165, 138, 248, 0.32);
    }
    body.light .agent-pill {
      background: rgba(124, 58, 237, 0.10);
      color: #6d28d9;
      border-color: rgba(124, 58, 237, 0.25);
    }

    pre.md-code-block {
      margin: 0;
      padding: 13px 15px;
      border-radius: 11px;
      font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
      font-size: 12px;
      line-height: 1.54;
      background-color: var(--card);
      border: 1px solid var(--card-border);
      overflow-x: auto;
    }
    .tok-kw { color: #c792ea; }
    .tok-fn { color: #82aaff; }
    .tok-str { color: #c3e88d; }
    .tok-num { color: #f78c6c; }
    .tok-cm { color: #7982a9; }
    body.light .tok-kw { color: #7c3aed; }
    body.light .tok-fn { color: #1d4ed8; }
    body.light .tok-str { color: #15803d; }
    body.light .tok-num { color: #c2410c; }
    body.light .tok-cm { color: #64748b; }

    [data-testid="background-task-command"] {
      padding: 11px 15px;
      border-radius: 11px;
      background-color: #0d1017;
      border: 1px solid var(--card-border);
      font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
      font-size: 11.5px;
      line-height: 1.62;
    }
    body.light [data-testid="background-task-command"] {
      background-color: #161b26;
      color: #e2e8f0;
    }

    .composer-dock {
      padding: 8px 32px 16px;
      flex-shrink: 0;
    }
    .surface-composer-card {
      position: relative;
      padding: 12px 15px 10px;
      border-radius: 13px;
      background-color: var(--card);
      border: 1px solid var(--card-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #hub-composer-input {
      width: 100%;
      min-height: 36px;
      resize: none;
      border: none;
      outline: none;
      background: transparent;
      color: inherit;
      font-family: inherit;
      font-size: 13px;
    }
    .agy-composer-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11.5px;
      opacity: 0.92;
    }
    .footer-chip {
      padding: 2px 9px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
    }
    body.light .footer-chip {
      background: rgba(15, 23, 42, 0.05);
    }

    .hub-aux-pane {
      width: 296px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      padding: 14px;
      gap: 11px;
      background-color: var(--sidebar);
    }
    .hub-aux-studio {
      width: 440px;
      padding: 0;
      overflow: hidden;
    }
    .aux-card {
      padding: 11px 13px;
      border-radius: 10px;
      background-color: var(--card);
      border: 1px solid var(--card-border);
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .aux-kv {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11.5px;
      opacity: 0.82;
    }
    .mini-pill {
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      background: rgba(127, 166, 248, 0.16);
      color: #8ab4f8;
    }
    .mini-pill.ok {
      background: rgba(80, 163, 123, 0.18);
      color: #6ee7b7;
    }
    body.light .mini-pill { color: #1d4ed8; }
    body.light .mini-pill.ok { color: #047857; }
    .accent-bar-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 3px;
    }
    .accent-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.35);
    }

    #agy-showcase-frame-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
      display: none;
    }
  </style>
</head>
<body class="${themeClass}">
  <div id="root">
    <div>
      <div>
        <div class="agy-shell bg-background">
          <header data-testid="title-menu-bar">
            <div class="hub-title-left">
              <span class="hub-logo-gem">◆</span>
              <span>Antigravity 2.0</span>
              <span style="opacity:0.4">/</span>
              <span>agy-wallpaper-prism</span>
              <span class="hub-badge">Wallpaper Prism v${PLUGIN_VERSION}</span>
            </div>
            <div style="display:flex;align-items:center;gap:14px;opacity:0.78;font-size:11.5px">
              <span>Swarm · 5 Agents</span>
              <span>0 Agent Token</span>
              <span style="opacity:0.9">Ctrl+Alt+W</span>
            </div>
          </header>

          <div data-testid="sidebar-split">
            <aside class="agy-sidebar bg-sidebar">
              <div>
                <div class="nav-section-label">Workspaces</div>
                <div class="nav-item active">
                  <span>agy-wallpaper-prism</span>
                  <span class="dot-online"></span>
                </div>
                <div class="nav-item"><span>obsidian-prism-theme</span></div>
              </div>
              <div>
                <div class="nav-section-label">Swarm Roster</div>
                <div class="nav-item active"><span>@coordinator</span><span class="dot-online"></span></div>
                <div class="nav-item"><span>@prism-designer</span><span class="dot-online"></span></div>
                <div class="nav-item"><span>@studio-builder</span><span class="dot-online"></span></div>
                <div class="nav-item"><span>@media-engine</span><span class="dot-online"></span></div>
                <div class="nav-item"><span>@verifier</span><span class="dot-online"></span></div>
              </div>
              <div style="margin-top:auto">
                <div class="nav-section-label">Installed Plugins</div>
                <div class="nav-item active"><span>◆ Wallpaper Prism</span><span style="font-size:10.5px;opacity:0.75">v${PLUGIN_VERSION}</span></div>
                <div class="nav-item"><span>🐾 Gemini Neko</span><span style="font-size:10.5px;opacity:0.7">HUD</span></div>
              </div>
            </aside>

            <div class="split-gutter" title="Resize Sidebar"></div>

            <div style="display:flex;flex:1;min-width:0;min-height:0">
              <div data-testid="aux-pane-split">
                <main class="hub-main-pane">
                  <section data-testid="conversation-view">
                    <div class="msg-user bg-card">
                      把 Steam 创意工坊里的 <strong>崩坏3周年庆（动态）</strong> 4K 60fps 壁纸套上 <strong>Obsidian Prism 浮岛毛玻璃</strong>，同时锁定代码块与终端的可读性对比度底线。
                    </div>

                    <div class="msg-agent">
                      <div class="msg-agent-head">
                        <span>Antigravity</span>
                        <span class="agent-pill">Wallpaper Prism Sidecar</span>
                      </div>
                      <div>
                        已激活 <code>Floating Islands</code> 8px 浮岛布局与 32×32 壁纸色度动态取色，全程零修改 <code>app.asar</code>、零 Agent Token 消耗：
                      </div>

                      <pre class="md-code-block"><code><span class="tok-cm">// Zero-copy virtual MP4 faststart + Obsidian Prism 6-tier glass hierarchy</span>
<span class="tok-kw">export async function</span> <span class="tok-fn">activatePrismIslands</span>(engine) {
  <span class="tok-kw">return await</span> engine.<span class="tok-fn">applyWallpaper</span>(<span class="tok-str">'ws-2876797752'</span>, {
    layoutMode: <span class="tok-str">'islands'</span>,      <span class="tok-cm">// 8px floating glass gap</span>
    colorScheme: <span class="tok-str">'prism-default'</span>,
    accentMode: <span class="tok-str">'dynamic'</span>,      <span class="tok-cm">// 32x32 chroma histogram</span>
    glassBlur: <span class="tok-num">16</span>,
    contrastFloor: <span class="tok-kw">true</span>,        <span class="tok-cm">// WCAG code/terminal lock</span>
  });
}</code></pre>

                      <div data-testid="background-task-command">
                        <div class="xterm">
                          <div class="xterm-viewport">
                            <div class="xterm-rows" style="color:#d6dced">
                              <div><span style="color:#50e3c2">✓</span> [steam-431960] Auto-discovered Steam/steamapps/workshop/content/431960 (8.3ms cached boot)</div>
                              <div><span style="color:#50e3c2">✓</span> [mp4-vfs] Streaming 崩坏3周年庆（动态） 3840×2160 @ 60fps · HTTP 206 Range · 0 disk writes</div>
                              <div><span style="color:#7fa6f8">◆</span> [prism-skin] Islands gap=8px · blur=16px · switch=2.5ms · WCAG readability floor &ge; 0.72</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <div class="composer-dock">
                    <div id="antigravity" class="agentSidePanelInputBox">
                      <div class="surface-composer-card agy-composer" data-testid="agent-input-box">
                        <textarea id="hub-composer-input" placeholder="输入指令，或按 Ctrl+Alt+W 随时唤出 Quick Prism 浮层…"></textarea>
                        <div class="agy-composer-footer">
                          <span class="footer-chip">Swarm Ready</span>
                          <span class="footer-chip">Prism Islands</span>
                          <span style="margin-left:auto;opacity:0.68;font-size:11px">Ctrl+Alt+W · Quick Prism Popover</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </main>

                <div class="split-gutter" title="Resize Aux Pane"></div>

                ${auxSlotHtml}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Sibling plugin overlays (untouched by Wallpaper Prism) -->
  <div id="ag-context-meter" style="position:fixed;top:8px;right:218px;z-index:7500;padding:2px 9px;border-radius:999px;background:rgba(16,185,129,0.16);border:1px solid rgba(16,185,129,0.36);color:#6ee7b7;font-size:11px;font-weight:600;pointer-events:none">CTX 18%</div>
  <div id="gemini-neko-pet-root" style="position:fixed;right:18px;bottom:16px;z-index:2147482800;padding:6px 11px;border-radius:999px;background:rgba(24,24,34,0.86);border:1px solid rgba(255,255,255,0.14);color:#f5d0fe;font-size:11.5px;pointer-events:none;backdrop-filter:blur(10px)">🐾 Neko HUD</div>

  <script>
    window.__SHOWCASE_BOOT__ = ${bootDataJson};

    // Wire real window.__agyPrismCall RPC bridge to showcase-server.mjs /api/rpc
    window.__agyPrismCall = function(reqJson) {
      var parsed;
      try {
        parsed = typeof reqJson === 'string' ? JSON.parse(reqJson) : (reqJson || {});
      } catch (_) {
        return Promise.resolve(null);
      }
      return fetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
        .then(function(r) { return r.json(); })
        .then(function(resp) {
          var result = resp && resp.result !== undefined ? resp.result : resp;
          if (parsed && parsed.id) {
            var envelope = { id: parsed.id, ok: resp && resp.ok !== false, result: result };
            try { if (window.__agyPrism && window.__agyPrism.receive) window.__agyPrism.receive(envelope); } catch (_) {}
            try { if (window.__agyPrismPanel && window.__agyPrismPanel.receive) window.__agyPrismPanel.receive(envelope); } catch (_) {}
          }
          return result;
        })
        .catch(function() { return null; });
    };
  </script>
  <script src="/host/wallpaper-inject.js"></script>
  <script src="/host/panel-inject.js"></script>
  <script>
    (function bootShowcaseHubBridge() {
      var boot = window.__SHOWCASE_BOOT__ || {};
      var currentPayload = boot.initialSkinPayload || null;
      var currentState = boot.initialCanonicalState || null;
      var framesMeta = boot.honkaiFramesMeta || { frameCount: 721, fps: 60, urlPrefix: '/media/honkai3-frames/' };
      var frameImgCache = new Map();
      var activeCanvasFrameUrl = '';

      function syncAuxTelemetry(state) {
        if (!state || !state.activeItem) return;
        var titleEl = document.getElementById('aux-active-title');
        var metaEl = document.getElementById('aux-active-meta');
        if (titleEl) titleEl.textContent = state.activeItem.title || state.activeItem.id;
        if (metaEl) {
          var res = state.activeItem.resolution || ((state.activeItem.width || 1920) + '×' + (state.activeItem.height || 1080));
          var fps = state.activeItem.fps ? state.activeItem.fps + 'fps' : 'Live';
          var src = state.activeItem.source === 'workshop' ? 'Steam Workshop' : 'Prism Curated';
          metaEl.textContent = res + ' · ' + fps + ' · ' + src;
        }
      }

      function applyBodyTheme(themeMode) {
        if (themeMode !== 'dark' && themeMode !== 'light') return;
        document.documentElement.classList.remove('dark', 'light');
        document.documentElement.classList.add(themeMode);
        document.body.classList.remove('dark', 'light');
        document.body.classList.add(themeMode);
      }

      function applyHostUpdate(payload, state) {
        if (payload) {
          currentPayload = payload;
          if (payload.config && (payload.config.themeMode === 'dark' || payload.config.themeMode === 'light')) {
            applyBodyTheme(payload.config.themeMode);
          }
          if (window.__agyPrism && typeof window.__agyPrism.applyPayload === 'function') {
            window.__agyPrism.applyPayload(payload);
          }
        }
        if (state) {
          currentState = state;
          syncAuxTelemetry(state);
          if (window.__agyPrismPanel && typeof window.__agyPrismPanel.syncState === 'function') {
            window.__agyPrismPanel.syncState(state);
          }
        }
        // Keep deterministic frame canvas synced with active wallpaper & skin visibility
        var cvs = document.getElementById('agy-showcase-frame-canvas');
        if (cvs) {
          var isHero = !currentPayload || !currentPayload.activeItem || currentPayload.activeItem.id === 'ws-2876797752';
          var skinOn = !currentPayload || currentPayload.skinEnabled !== false;
          cvs.style.display = (activeCanvasFrameUrl && isHero && skinOn) ? 'block' : 'none';
        }
      }

      // Initial hydration
      applyHostUpdate(currentPayload, currentState);

      // Live SSE stream so Studio edits immediately reflect inside /hub
      if (typeof EventSource === 'function') {
        try {
          var es = new EventSource('/api/events');
          es.onmessage = function(ev) {
            try {
              var data = JSON.parse(ev.data);
              if (data && (data.skinPayload || data.state)) {
                applyHostUpdate(data.skinPayload, data.state);
              }
            } catch (_) {}
          };
        } catch (_) {}
      }

      function loadCachedImage(url) {
        if (frameImgCache.has(url)) return Promise.resolve(frameImgCache.get(url));
        return new Promise(function(resolve) {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function() {
            if (frameImgCache.size > 120) {
              var oldest = frameImgCache.keys().next().value;
              frameImgCache.delete(oldest);
            }
            frameImgCache.set(url, img);
            resolve(img);
          };
          img.onerror = function() { resolve(null); };
          img.src = url;
        });
      }

      function ensureStageFrameCanvas() {
        var stage = document.getElementById('agy-prism-stage');
        if (!stage) return null;
        var cvs = document.getElementById('agy-showcase-frame-canvas');
        if (!cvs) {
          cvs = document.createElement('canvas');
          cvs.id = 'agy-showcase-frame-canvas';
          var scrim = stage.querySelector('.agy-prism-scrim');
          if (scrim) stage.insertBefore(cvs, scrim);
          else stage.appendChild(cvs);
        }
        // Mirror media wrap optical filter & opacity so mediaBlur / brightness / saturation work identically!
        var mediaWrap = stage.querySelector('.agy-prism-media-wrap');
        if (mediaWrap) {
          var cs = getComputedStyle(mediaWrap);
          cvs.style.opacity = cs.opacity || '1';
          cvs.style.filter = cs.filter || 'none';
          cvs.style.transform = cs.transform || 'none';
          var vid = mediaWrap.querySelector('video');
          if (vid) {
            try { vid.pause(); } catch (_) {}
            vid.style.opacity = '0';
          }
        }
        return cvs;
      }

      function setVideoFrame(frameIdxOrUrl) {
        var url = '';
        if (typeof frameIdxOrUrl === 'string' && frameIdxOrUrl.includes('/')) {
          url = frameIdxOrUrl;
        } else {
          var count = Math.max(1, Number(framesMeta.frameCount || 721));
          var idx = ((Math.floor(Number(frameIdxOrUrl) || 0) % count) + count) % count;
          url = (framesMeta.urlPrefix || '/media/honkai3-frames/') + String(idx).padStart(4, '0') + '.jpg';
        }
        activeCanvasFrameUrl = url;
        var isHero = !currentPayload || !currentPayload.activeItem || currentPayload.activeItem.id === 'ws-2876797752';
        var skinOn = !currentPayload || currentPayload.skinEnabled !== false;
        var cvs = ensureStageFrameCanvas();
        if (!cvs) return Promise.resolve(false);
        if (!isHero || !skinOn) {
          cvs.style.display = 'none';
          return Promise.resolve(true);
        }
        return loadCachedImage(url).then(function(img) {
          if (!img) return false;
          var cw = Math.max(2, window.innerWidth || 1920);
          var ch = Math.max(2, window.innerHeight || 1080);
          if (cvs.width !== cw || cvs.height !== ch) {
            cvs.width = cw;
            cvs.height = ch;
          }
          var ctx = cvs.getContext('2d');
          if (!ctx) return false;
          var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
          var dw = img.naturalWidth * scale;
          var dh = img.naturalHeight * scale;
          ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
          cvs.style.display = 'block';
          return true;
        });
      }

      window.__showcaseHub = {
        setTheme: function(mode) {
          applyBodyTheme(mode);
          return fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patch: { themeMode: mode } }),
          }).then(function(r) { return r.json(); }).then(function(d) {
            if (d && d.skinPayload) applyHostUpdate(d.skinPayload, d.state);
            return d;
          });
        },
        setSkinEnabled: function(enabled) {
          var endpoint = enabled ? '/api/config' : '/api/skin/restore';
          var body = enabled ? { patch: { skinEnabled: true } } : {};
          return fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).then(function(r) { return r.json(); }).then(function(d) {
            if (d && d.skinPayload) applyHostUpdate(d.skinPayload, d.state);
            return d;
          });
        },
        setLayout: function(layoutMode) {
          var patch = layoutMode === 'flush'
            ? { layoutMode: 'flush', islandGap: 0, workspacePad: 0 }
            : { layoutMode: 'islands', islandGap: 8, workspacePad: 8 };
          return this.applyConfig(patch);
        },
        setScheme: function(colorScheme, themeMode) {
          var patch = { colorScheme: colorScheme };
          if (themeMode) {
            patch.themeMode = themeMode;
            applyBodyTheme(themeMode);
          }
          return this.applyConfig(patch);
        },
        applyConfig: function(patch) {
          return fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patch: patch || {} }),
          }).then(function(r) { return r.json(); }).then(function(d) {
            if (d && d.skinPayload) applyHostUpdate(d.skinPayload, d.state);
            return d;
          });
        },
        applyWallpaper: function(wallpaperId, patch) {
          return fetch('/api/wallpaper/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallpaperId: wallpaperId, patch: patch || {} }),
          }).then(function(r) { return r.json(); }).then(function(d) {
            if (d && d.skinPayload) applyHostUpdate(d.skinPayload, d.state);
            return d;
          });
        },
        openQuickPanel: function() {
          if (window.__agyPrismPanel && window.__agyPrismPanel.open) window.__agyPrismPanel.open();
        },
        closeQuickPanel: function() {
          if (window.__agyPrismPanel && window.__agyPrismPanel.close) window.__agyPrismPanel.close();
        },
        toggleQuickPanel: function(forceOpen) {
          if (!window.__agyPrismPanel) return;
          if (forceOpen === true) window.__agyPrismPanel.open();
          else if (forceOpen === false) window.__agyPrismPanel.close();
          else window.__agyPrismPanel.toggle();
        },
        pressQuickShortcut: function() {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
        },
        setVideoFrame: setVideoFrame,
        clearVideoFrame: function() {
          activeCanvasFrameUrl = '';
          var cvs = document.getElementById('agy-showcase-frame-canvas');
          if (cvs) cvs.style.display = 'none';
          var vid = document.querySelector('#agy-prism-stage video');
          if (vid) vid.style.opacity = '1';
        },
        getState: function() { return { payload: currentPayload, state: currentState }; },
      };

      // Cross-frame command listener for scene/choreography.js
      window.addEventListener('message', function(ev) {
        var msg = ev.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'showcase-frame') {
          setVideoFrame(msg.frameUrl || msg.frameIdx);
        } else if (msg.type === 'showcase-cmd' && msg.cmd && typeof window.__showcaseHub[msg.cmd] === 'function') {
          window.__showcaseHub[msg.cmd].apply(window.__showcaseHub, Array.isArray(msg.args) ? msg.args : []);
        }
      });

      if (boot.frameMode === 'canvas') {
        setVideoFrame(0);
      }
    })();
  </script>
</body>
</html>`;
}

export async function createShowcaseServer(options = {}) {
  const listenPort = options.port !== undefined ? Number(options.port) : 0;
  const libDoc = loadSanitizedLibrary();
  const baseItems = libDoc.items || [];
  const heroId = libDoc.meta?.heroId || baseItems[0]?.id || 'ws-2876797752';
  const sanitizedPaths = libDoc.meta?.paths || {
    steamRoot: 'Steam/steamapps/workshop/content/431960',
    uploadDir: '~/Pictures/wallpapers',
    cacheDir: '~/.agy-wallpaper-prism/cache',
    dataDir: '~/.agy-wallpaper-prism',
  };

  let items = structuredClone(baseItems);
  let userPresets = [];
  let normalShortcutEnabled = Boolean(options.normalShortcutEnabled ?? false);
  let config = sanitizeConfig({
    ...DEFAULT_CONFIG,
    skinEnabled: true,
    activeWallpaperId: heroId,
    wallpaperId: heroId,
    kind: 'video',
    preset: 'islands',
    layoutMode: 'islands',
    islandGap: 8,
    workspacePad: 8,
    colorScheme: 'prism-default',
    accentMode: 'dynamic',
    themeMode: 'dark',
    extractedAccent: libDoc.accentCache?.[heroId] || {
      wallpaperId: heroId,
      darkHex: '#7FA6F8',
      lightHex: '#3B6FD8',
      tintRgb: '127, 166, 248',
    },
    accentCache: structuredClone(libDoc.accentCache || {}),
    uploadDir: sanitizedPaths.uploadDir,
    cacheDir: sanitizedPaths.cacheDir,
    customFolders: [],
    language: 'zh',
    ...(options.initialConfig || {}),
  });

  const sseClients = new Set();

  function getActiveItem() {
    const wid = config.activeWallpaperId || config.wallpaperId || heroId;
    return items.find((it) => it.id === wid) || items[0] || null;
  }

  function getPresets() {
    return [...FACTORY_PRESETS, ...userPresets];
  }

  function getStats() {
    const byKind = { image: 0, video: 0, slideshow: 0, web: 0, scene: 0 };
    const bySource = { workshop: 0, default: 0, upload: 0, local: 0 };
    for (const it of items) {
      if (it.kind in byKind) byKind[it.kind] += 1;
      if (it.source in bySource) bySource[it.source] += 1;
    }
    return {
      total: items.length,
      workshop: bySource.workshop,
      uploads: bySource.upload + bySource.local,
      byKind,
      bySource,
      scanDurationMs: 8.3,
      scannedAt: libDoc.stats?.scannedAt || 1763800000000,
      steamRoot: sanitizedPaths.steamRoot,
      uploadDir: config.uploadDir || sanitizedPaths.uploadDir,
      cacheDir: config.cacheDir || sanitizedPaths.cacheDir,
      dataDir: sanitizedPaths.dataDir,
      mediaOrigin: '',
    };
  }

  function getAutostartState() {
    const patchedShortcuts = normalShortcutEnabled
      ? ['Desktop/Antigravity.lnk', 'StartMenu/Antigravity.lnk']
      : [];
    return {
      ok: true,
      supported: true,
      normalShortcutEnabled,
      anyShortcutEnabled: normalShortcutEnabled,
      port: config.debugPort || DEFAULT_DEBUG_PORT,
      sidecarAutoStartsOnBoot: true,
      autoRestoreLastSettings: true,
      shortcuts: [
        { name: 'Desktop/Antigravity.lnk', patched: normalShortcutEnabled, port: config.debugPort || DEFAULT_DEBUG_PORT },
        { name: 'StartMenu/Antigravity.lnk', patched: normalShortcutEnabled, port: config.debugPort || DEFAULT_DEBUG_PORT },
      ],
      patchedShortcuts,
    };
  }

  function buildCanonicalState(originStr = '') {
    const activeItem = getActiveItem();
    const effectiveConfig = resolveEffectiveConfig(config, activeItem?.id || config.activeWallpaperId);
    const autostart = getAutostartState();
    const hostStatus = {
      phase: 'attached',
      cdpReachable: true,
      port: config.debugPort || DEFAULT_DEBUG_PORT,
      pluginEnabled: true,
      attachedTargets: [
        { id: 'hub-main', title: 'Antigravity 2.0 — agy-wallpaper-prism', type: 'page' },
      ],
      attachedCount: 1,
      version: PLUGIN_VERSION,
      normalShortcutEnabled: autostart.normalShortcutEnabled,
      anyShortcutEnabled: autostart.anyShortcutEnabled,
      patchedShortcuts: autostart.patchedShortcuts,
      shortcuts: autostart.shortcuts,
      sidecarAutoStartsOnBoot: true,
      autoRestoreLastSettings: true,
    };
    const stats = { ...getStats(), mediaOrigin: originStr };
    return {
      ok: true,
      config,
      effectiveConfig,
      activeItem,
      skinEnabled: config.skinEnabled !== false,
      presets: getPresets(),
      hostStatus,
      autostart,
      normalShortcutEnabled: autostart.normalShortcutEnabled,
      patchedShortcuts: autostart.patchedShortcuts,
      sidecarAutoStartsOnBoot: true,
      autoRestoreLastSettings: true,
      stats,
      mediaOrigin: originStr,
      pid: process.pid,
      version: PLUGIN_VERSION,
      studioUri: SIDECAR_URI,
      wallpaperId: activeItem?.id || '',
      kind: activeItem?.kind || 'video',
      mediaUrl: activeItem?.mediaUrl || '',
      thumbUrl: activeItem?.thumbUrl || '',
    };
  }

  function buildSkinPayload(originStr = '', overrides = {}) {
    const activeItem = getActiveItem();
    const cfg = overrides.config ? sanitizeConfig({ ...config, ...overrides.config }) : config;
    return buildClientSkinPayload(cfg, activeItem, originStr, {
      skinEnabled: overrides.skinEnabled !== undefined ? overrides.skinEnabled : cfg.skinEnabled !== false,
    });
  }

  function broadcastUpdate(originStr = '') {
    if (sseClients.size === 0) return;
    const msg = `data: ${JSON.stringify({
      state: buildCanonicalState(originStr),
      skinPayload: buildSkinPayload(originStr),
    })}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(msg);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  function applyConfigPatch(patch = {}) {
    config = sanitizeConfig({ ...config, ...patch });
    if (patch.activeWallpaperId || patch.wallpaperId) {
      const wid = String(patch.activeWallpaperId || patch.wallpaperId);
      const found = items.find((it) => it.id === wid);
      if (found) {
        config = sanitizeConfig({
          ...config,
          activeWallpaperId: found.id,
          wallpaperId: found.id,
          kind: found.kind,
          extractedAccent: config.accentCache?.[found.id] || config.extractedAccent,
        });
      }
    }
  }

  function applyWallpaperById(wid, extraPatch = {}) {
    const target = items.find((it) => it.id === wid) || items[0];
    if (!target) return;
    applyConfigPatch({
      ...extraPatch,
      activeWallpaperId: target.id,
      wallpaperId: target.id,
      kind: target.kind,
      skinEnabled: true,
      extractedAccent: config.accentCache?.[target.id] || config.extractedAccent,
    });
  }

  function applyPresetById(presetId) {
    const id = String(presetId || '').trim();
    if (!id) throw new Error('Missing presetId');
    if (SCENE_PRESET_IDS.includes(id)) {
      applyConfigPatch({ ...SCENE_PRESETS[id].patch, skinEnabled: true });
      return;
    }
    const found = getPresets().find((p) => p.id === id);
    if (!found) throw new Error(`Unknown preset: ${id}`);
    applyConfigPatch({ ...(found.patch || {}), activeProfilePresetId: found.id, skinEnabled: true });
  }

  function resetState() {
    items = structuredClone(baseItems);
    userPresets = [];
    normalShortcutEnabled = Boolean(options.normalShortcutEnabled ?? false);
    config = sanitizeConfig({
      ...DEFAULT_CONFIG,
      skinEnabled: true,
      activeWallpaperId: heroId,
      wallpaperId: heroId,
      kind: 'video',
      preset: 'islands',
      layoutMode: 'islands',
      islandGap: 8,
      workspacePad: 8,
      colorScheme: 'prism-default',
      accentMode: 'dynamic',
      themeMode: 'dark',
      extractedAccent: libDoc.accentCache?.[heroId] || null,
      accentCache: structuredClone(libDoc.accentCache || {}),
      uploadDir: sanitizedPaths.uploadDir,
      cacheDir: sanitizedPaths.cacheDir,
      customFolders: [],
      language: 'zh',
      ...(options.initialConfig || {}),
    });
  }

  function handleRpc(method, params = {}, originStr = '') {
    switch (method) {
      case 'state.get':
      case 'bootstrap.get':
        return buildCanonicalState(originStr);
      case 'library.list':
        return { items, stats: getStats() };
      case 'config.set':
      case 'prefs.set': {
        const patch = params.patch && typeof params.patch === 'object' ? params.patch : params;
        applyConfigPatch(patch);
        broadcastUpdate(originStr);
        return buildCanonicalState(originStr);
      }
      case 'config.reset':
      case 'prefs.reset': {
        const scope = String(params.scope || 'all');
        const keys = scope === 'all'
          ? [...RESET_SCOPES.skin, ...RESET_SCOPES.optics, ...RESET_SCOPES.playback]
          : (RESET_SCOPES[scope] || []);
        const resetPatch = {};
        for (const k of keys) resetPatch[k] = DEFAULT_CONFIG[k];
        applyConfigPatch(resetPatch);
        broadcastUpdate(originStr);
        return buildCanonicalState(originStr);
      }
      case 'wallpaper.apply': {
        applyWallpaperById(String(params.wallpaperId || params.id || heroId), params.patch || {});
        broadcastUpdate(originStr);
        return buildCanonicalState(originStr);
      }
      case 'playlist.step': {
        const dir = Number(params.direction) === -1 ? -1 : 1;
        const idx = Math.max(0, items.findIndex((it) => it.id === config.activeWallpaperId));
        const next = items[(idx + dir + items.length) % items.length];
        if (next) applyWallpaperById(next.id);
        broadcastUpdate(originStr);
        return buildCanonicalState(originStr);
      }
      case 'preset.apply': {
        applyPresetById(params.presetId || params.id || params.name);
        broadcastUpdate(originStr);
        return buildCanonicalState(originStr);
      }
      case 'accent.save': {
        const wid = String(params.wallpaperId || config.activeWallpaperId || heroId);
        const entry = {
          wallpaperId: wid,
          darkHex: String(params.darkHex || '#7FA6F8'),
          lightHex: String(params.lightHex || '#3B6FD8'),
          tintRgb: String(params.tintRgb || '127, 166, 248'),
        };
        applyConfigPatch({
          extractedAccent: entry,
          accentCache: { ...(config.accentCache || {}), [wid]: entry },
        });
        broadcastUpdate(originStr);
        return { ok: true, extractedAccent: entry };
      }
      case 'skin.restore': {
        applyConfigPatch({ skinEnabled: false });
        broadcastUpdate(originStr);
        return buildCanonicalState(originStr);
      }
      case 'autostart.get':
        return getAutostartState();
      case 'autostart.set': {
        normalShortcutEnabled = params.enabled !== false;
        broadcastUpdate(originStr);
        const autostart = getAutostartState();
        return { ok: true, autostart, state: buildCanonicalState(originStr) };
      }
      case 'studio.open':
        return { ok: true, uri: SIDECAR_URI };
      default:
        return { ok: false, error: `Unknown RPC method: ${method}` };
    }
  }

  let actualOrigin = '';

  const handleRequest = async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Sidecar-Token, Range',
      });
      res.end();
      return;
    }

    const hostHeader = req.headers.host || '127.0.0.1';
    const originStr = actualOrigin || `http://${hostHeader}`;
    const urlObj = new URL(req.url || '/', originStr);
    const pathname = urlObj.pathname;

    // 1. Showcase Landing Index
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Wallpaper Prism Showcase</title>
        <style>body{margin:0;padding:36px;background:#09090d;color:#eef2ff;font-family:Segoe UI,Microsoft YaHei UI,sans-serif;}
        a{color:#7fa6f8;margin-right:16px;font-weight:600;}</style></head>
        <body><h2>Wallpaper Prism · Sanitized Showcase Server</h2>
        <p><a href="/studio">/studio (Real Sidecar Studio UI)</a>
        <a href="/hub">/hub (Sanitized Antigravity 2.0 Hub)</a>
        <a href="/hub?aux=studio">/hub?aux=studio (Hub + Live Studio Aux Pane)</a>
        <a href="/api/showcase/meta">/api/showcase/meta</a></p></body></html>`);
      return;
    }

    // 2. Real Built Sidecar Studio UI (`/studio`)
    if (req.method === 'GET' && (pathname === '/studio' || pathname === '/studio/' || pathname === '/studio/index.html')) {
      const rawHtml = existsSync(STUDIO_HTML_PATH)
        ? readFileSync(STUDIO_HTML_PATH, 'utf8')
        : '<!doctype html><html><body>Studio bundle not found.</body></html>';
      const bootTag = `<script>window.__SIDECAR_BOOT__=${JSON.stringify({ token: '', conversationId: 'showcase-demo', showcase: true })};</script>`;
      const html = rawHtml.includes('</head>')
        ? rawHtml.replace('</head>', `${bootTag}\n</head>`)
        : `${bootTag}\n${rawHtml}`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && pathname === '/preload.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(STUDIO_PRELOAD_SHIM_JS);
      return;
    }

    // 3. Real Host Injection Scripts (`/host/wallpaper-inject.js`, `/host/panel-inject.js`)
    if (req.method === 'GET' && pathname === '/host/wallpaper-inject.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(readFileSync(WALLPAPER_INJECT_PATH, 'utf8'));
      return;
    }
    if (req.method === 'GET' && pathname === '/host/panel-inject.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(readFileSync(PANEL_INJECT_PATH, 'utf8'));
      return;
    }

    // 4. Hyper-Accurate Sanitized Antigravity 2.0 Hub (`/hub`)
    if (req.method === 'GET' && (pathname === '/hub' || pathname === '/hub/')) {
      const qTheme = urlObj.searchParams.get('theme') === 'light' ? 'light' : 'dark';
      const qAux = urlObj.searchParams.get('aux') === 'studio' ? 'studio' : 'telemetry';
      const qFrameMode = urlObj.searchParams.get('frameMode') === 'canvas' ? 'canvas' : 'video';
      const qSkin = urlObj.searchParams.get('skin');
      const skinOverrides = {};
      if (qSkin === '0' || qSkin === 'false') skinOverrides.skinEnabled = false;
      if (urlObj.searchParams.has('theme')) skinOverrides.config = { themeMode: qTheme };

      const html = buildSanitizedShowcaseHubHtml({
        initialTheme: qTheme,
        auxMode: qAux,
        frameMode: qFrameMode,
        initialSkinPayload: buildSkinPayload(originStr, skinOverrides),
        initialCanonicalState: buildCanonicalState(originStr),
        honkaiFramesMeta: libDoc.meta?.honkaiFrames || { frameCount: 721, fps: 60, urlPrefix: '/media/honkai3-frames/' },
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    // 5. Media Files (`/media/*` with CORS & HTTP 206 Range)
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/media/')) {
      const rel = decodeURIComponent(pathname.slice('/media/'.length));
      const absFile = resolveFencedFile(SHOWCASE_DIR, rel);
      if (!absFile) {
        sendJson(res, 404, { ok: false, error: `Media asset not found: ${rel}` });
        return;
      }
      serveStaticFileWithRange(req, res, absFile);
      return;
    }

    // 6. Optional Same-Origin Static Serving for `/scene/*` and `/audio/*`
    if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/scene' || pathname.startsWith('/scene/'))) {
      const rel = pathname === '/scene' || pathname === '/scene/'
        ? 'index.html'
        : decodeURIComponent(pathname.slice('/scene/'.length));
      const absFile = resolveFencedFile(join(INTRO_ROOT, 'scene'), rel);
      if (!absFile) {
        sendJson(res, 404, { ok: false, error: `Scene asset not found: ${rel}` });
        return;
      }
      serveStaticFileWithRange(req, res, absFile, { cacheControl: 'no-store' });
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/audio/')) {
      const rel = decodeURIComponent(pathname.slice('/audio/'.length));
      const absFile = resolveFencedFile(join(INTRO_ROOT, 'audio'), rel);
      if (!absFile) {
        sendJson(res, 404, { ok: false, error: `Audio asset not found: ${rel}` });
        return;
      }
      serveStaticFileWithRange(req, res, absFile, { cacheControl: 'no-store' });
      return;
    }

    // 7. SSE Live Events Stream (`/api/events`)
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`data: ${JSON.stringify({ state: buildCanonicalState(originStr), skinPayload: buildSkinPayload(originStr) })}\n\n`);
      if (res._isInject) {
        res.end();
        return;
      }
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // 8. GET APIs
    if (req.method === 'GET' && pathname === '/api/showcase/meta') {
      sendJson(res, 200, {
        ok: true,
        origin: originStr,
        meta: libDoc.meta,
        stats: getStats(),
        heroId,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/bootstrap') {
      sendJson(res, 200, buildCanonicalState(originStr));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/library') {
      sendJson(res, 200, { items, stats: getStats() });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/status') {
      const st = buildCanonicalState(originStr);
      sendJson(res, 200, {
        ok: true,
        hostStatus: st.hostStatus,
        autostart: st.autostart,
        normalShortcutEnabled: st.normalShortcutEnabled,
        patchedShortcuts: st.patchedShortcuts,
        sidecarAutoStartsOnBoot: true,
        autoRestoreLastSettings: true,
        stats: st.stats,
        skinEnabled: st.skinEnabled,
        activeItem: st.activeItem,
        mediaOrigin: st.mediaOrigin,
        pid: process.pid,
        version: PLUGIN_VERSION,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/host/autostart') {
      sendJson(res, 200, {
        ...getAutostartState(),
        skinEnabled: config.skinEnabled !== false,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/fs/browse') {
      const requested = String(urlObj.searchParams.get('path') || '').trim();
      const entry = SANITIZED_VIRTUAL_DIRS[requested] || SANITIZED_VIRTUAL_DIRS[''];
      sendJson(res, 200, {
        ok: true,
        current: entry.current,
        parent: entry.parent,
        dirs: entry.dirs,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/presets/export') {
      const id = String(urlObj.searchParams.get('id') || '');
      const found = getPresets().find((p) => p.id === id);
      if (!found) {
        sendJson(res, 404, { ok: false, error: `Preset not found: ${id}` });
        return;
      }
      sendJson(res, 200, found);
      return;
    }

    // 9. POST APIs
    if (req.method === 'POST') {
      const body = await readJsonBody(req);

      if (pathname === '/api/rpc') {
        const result = handleRpc(String(body?.method || ''), body?.params || {}, originStr);
        sendJson(res, 200, { ok: true, id: body?.id || null, result });
        return;
      }

      if (pathname === '/api/showcase/reset') {
        resetState();
        broadcastUpdate(originStr);
        sendJson(res, 200, { ok: true, state: buildCanonicalState(originStr), skinPayload: buildSkinPayload(originStr) });
        return;
      }

      if (pathname === '/api/config') {
        const patch = body && typeof body.patch === 'object' ? body.patch : body;
        applyConfigPatch(patch || {});
        broadcastUpdate(originStr);
        sendJson(res, 200, { ok: true, state: buildCanonicalState(originStr), skinPayload: buildSkinPayload(originStr) });
        return;
      }

      if (pathname === '/api/config/reset') {
        const scope = String(body?.scope || 'all');
        const keys = scope === 'all'
          ? [...RESET_SCOPES.skin, ...RESET_SCOPES.optics, ...RESET_SCOPES.playback]
          : (RESET_SCOPES[scope] || []);
        const resetPatch = {};
        for (const k of keys) resetPatch[k] = DEFAULT_CONFIG[k];
        applyConfigPatch(resetPatch);
        broadcastUpdate(originStr);
        sendJson(res, 200, { ok: true, state: buildCanonicalState(originStr), skinPayload: buildSkinPayload(originStr) });
        return;
      }

      if (pathname === '/api/wallpaper/apply') {
        const wid = String(body?.wallpaperId ?? body?.id ?? heroId);
        const extraPatch = body?.patch && typeof body.patch === 'object' ? body.patch : {};
        applyWallpaperById(wid, extraPatch);
        broadcastUpdate(originStr);
        sendJson(res, 200, { ok: true, state: buildCanonicalState(originStr), skinPayload: buildSkinPayload(originStr) });
        return;
      }

      if (pathname === '/api/playlist/step') {
        const dir = Number(body?.direction) === -1 ? -1 : 1;
        const idx = Math.max(0, items.findIndex((it) => it.id === config.activeWallpaperId));
        const next = items[(idx + dir + items.length) % items.length];
        if (next) applyWallpaperById(next.id);
        broadcastUpdate(originStr);
        sendJson(res, 200, { ok: true, state: buildCanonicalState(originStr), skinPayload: buildSkinPayload(originStr) });
        return;
      }

      if (pathname === '/api/preset/apply') {
        applyPresetById(body?.presetId || body?.id || body?.name);
        broadcastUpdate(originStr);
        sendJson(res, 200, { ok: true, state: buildCanonicalState(originStr), skinPayload: buildSkinPayload(originStr) });
        return;
      }

      if (pathname === '/api/presets/save') {
        const preset = {
          id: `user-${Date.now().toString(36)}`,
          name: String(body?.name || 'Custom Snapshot'),
          description: String(body?.description || ''),
          builtin: false,
          patch: {
            layoutMode: config.layoutMode,
            colorScheme: config.colorScheme,
            accentMode: config.accentMode,
            glassOpacity: config.glassOpacity,
            glassBlur: config.glassBlur,
            scrimOpacity: config.scrimOpacity,
          },
        };
        userPresets.push(preset);
        const state = buildCanonicalState(originStr);
        sendJson(res, 200, { ok: true, preset, presets: state.presets, state });
        return;
      }

      if (pathname === '/api/presets/delete') {
        const delId = String(body?.id || '');
        userPresets = userPresets.filter((p) => p.id !== delId);
        const state = buildCanonicalState(originStr);
        sendJson(res, 200, { ok: true, presets: state.presets, state });
        return;
      }

      if (pathname === '/api/presets/import') {
        const rawPreset = body?.preset && typeof body.preset === 'object' ? body.preset : body;
        const preset = {
          id: `user-${Date.now().toString(36)}`,
          name: String(rawPreset?.name || 'Imported Preset'),
          description: String(rawPreset?.description || ''),
          builtin: false,
          patch: rawPreset?.patch && typeof rawPreset.patch === 'object' ? rawPreset.patch : {},
        };
        userPresets.push(preset);
        const state = buildCanonicalState(originStr);
        sendJson(res, 200, { ok: true, preset, presets: state.presets, state });
        return;
      }

      if (pathname === '/api/wallpaper/props') {
        const wid = String(body?.wallpaperId || '');
        if (wid) {
          applyConfigPatch({
            userProps: { ...(config.userProps || {}), [wid]: { ...(body?.props || {}) } },
          });
        }
        broadcastUpdate(originStr);
        sendJson(res, 200, { ok: true, state: buildCanonicalState(originStr) });
        return;
      }

      if (pathname === '/api/storage/dir') {
        const kind = String(body?.kind || '');
        const cleanDir = String(body?.path || '').replace(/[A-Za-z]:\\Users\\[^\\]+/gi, '~');
        if (kind === 'uploadDir') applyConfigPatch({ uploadDir: cleanDir || sanitizedPaths.uploadDir });
        else if (kind === 'cacheDir') applyConfigPatch({ cacheDir: cleanDir || sanitizedPaths.cacheDir });
        else if (kind === 'addCustomFolder' && cleanDir) {
          applyConfigPatch({ customFolders: [...new Set([...(config.customFolders || []), cleanDir])] });
        } else if (kind === 'removeCustomFolder') {
          applyConfigPatch({ customFolders: (config.customFolders || []).filter((d) => d !== cleanDir) });
        }
        const state = buildCanonicalState(originStr);
        sendJson(res, 200, { ok: true, config: state.config, state });
        return;
      }

      if (pathname === '/api/skin/restore') {
        applyConfigPatch({ skinEnabled: false });
        broadcastUpdate(originStr);
        sendJson(res, 200, { ok: true, state: buildCanonicalState(originStr), skinPayload: buildSkinPayload(originStr) });
        return;
      }

      if (pathname === '/api/host/autostart') {
        normalShortcutEnabled = body?.enabled !== false;
        if (body?.port) applyConfigPatch({ debugPort: Number(body.port) });
        broadcastUpdate(originStr);
        const autostart = getAutostartState();
        const state = buildCanonicalState(originStr);
        sendJson(res, 200, {
          ok: true,
          autostart,
          hostStatus: state.hostStatus,
          normalShortcutEnabled: state.normalShortcutEnabled,
          patchedShortcuts: state.patchedShortcuts,
          sidecarAutoStartsOnBoot: true,
          autoRestoreLastSettings: true,
          state,
        });
        return;
      }

      if (pathname === '/api/host/shortcut') {
        const port = Number(body?.port || config.debugPort || DEFAULT_DEBUG_PORT);
        normalShortcutEnabled = true;
        broadcastUpdate(originStr);
        const state = buildCanonicalState(originStr);
        sendJson(res, 200, {
          ok: true,
          shortcutPath: 'Desktop/Antigravity (Prism).lnk',
          port,
          hostStatus: state.hostStatus,
          state,
        });
        return;
      }

      if (pathname === '/api/upload' || pathname === '/api/upload/remove') {
        const state = buildCanonicalState(originStr);
        sendJson(res, 200, { ok: true, items, state });
        return;
      }
    }

    sendJson(res, 404, { ok: false, error: `Showcase route not found: ${req.method} ${pathname}` });
  };

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 400, { ok: false, error: err?.message || String(err) });
      }
    });
  });

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => resolvePromise());
  });

  const addr = server.address();
  const actualPort = addr && typeof addr === 'object' ? addr.port : listenPort;
  actualOrigin = `http://127.0.0.1:${actualPort}`;

  const close = async () => {
    for (const res of sseClients) {
      try { res.end(); } catch { /* ignore */ }
    }
    sseClients.clear();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r()));
  };

  const inject = async ({ method = 'GET', url = '/', headers = {}, body = null } = {}) => {
    const lowerHeaders = { host: `127.0.0.1:${actualPort}` };
    for (const [k, v] of Object.entries(headers || {})) {
      lowerHeaders[k.toLowerCase()] = String(v);
    }
    let bodyBuf = Buffer.alloc(0);
    if (Buffer.isBuffer(body)) bodyBuf = body;
    else if (typeof body === 'string') bodyBuf = Buffer.from(body, 'utf8');
    else if (body && typeof body === 'object') {
      bodyBuf = Buffer.from(JSON.stringify(body), 'utf8');
      if (!lowerHeaders['content-type']) lowerHeaders['content-type'] = 'application/json';
    }

    const req = Readable.from(bodyBuf.length > 0 ? [bodyBuf] : []);
    req.method = String(method).toUpperCase();
    req.url = String(url);
    req.headers = lowerHeaders;
    req.destroy = () => {};

    let statusCode = 200;
    const resHeaders = {};
    const outChunks = [];
    let ended = false;
    let resolveDone;
    const donePromise = new Promise((r) => {
      resolveDone = r;
    });

    const res = {
      _isInject: true,
      headersSent: false,
      writeHead(code, hdrs = {}) {
        statusCode = code;
        this.headersSent = true;
        for (const [k, v] of Object.entries(hdrs)) resHeaders[k.toLowerCase()] = v;
        return this;
      },
      write(chunk) {
        if (chunk) outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (ended) return;
        ended = true;
        if (chunk) outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        const rawBody = Buffer.concat(outChunks);
        const text = rawBody.toString('utf8');
        resolveDone({
          statusCode,
          headers: resHeaders,
          body: rawBody,
          text,
          json() {
            return JSON.parse(text);
          },
        });
      },
    };

    try {
      await handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 400, { ok: false, error: err?.message || String(err) });
    }
    return donePromise;
  };

  return {
    server,
    port: actualPort,
    origin: actualOrigin,
    close,
    inject,
    getState: () => buildCanonicalState(actualOrigin),
    getSkinPayload: () => buildSkinPayload(actualOrigin),
    resetState,
  };
}

// Standalone CLI execution (`node assets/showcase/showcase-server.mjs [--port 0]`)
const isCliMain =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isCliMain) {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 && args[portIdx + 1] ? Number(args[portIdx + 1]) : 0;
  const srv = await createShowcaseServer({ port });
  console.log(
    JSON.stringify({
      ok: true,
      origin: srv.origin,
      port: srv.port,
      studioUrl: `${srv.origin}/studio`,
      hubUrl: `${srv.origin}/hub`,
      hubWithStudioUrl: `${srv.origin}/hub?aux=studio`,
      mediaBase: `${srv.origin}/media/`,
    }),
  );
  const shutdown = () => {
    srv.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
