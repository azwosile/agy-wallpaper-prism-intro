#!/usr/bin/env node
/**
 * High-DPI Bilibili Promo Cover Renderer for `agy-wallpaper-prism`.
 *
 * Produces two independently art-directed covers via Headless Chromium CDP Pipe:
 *   1. covers/cover-16x9.png (1920x1080) — Bilibili widescreen / homepage feed hero
 *   2. covers/cover-4x3.png  (1600x1200) — Bilibili 4:3 classic / dynamic feed card
 *
 * Zero external npm dependencies. Zero TCP port binding (uses --remote-debugging-pipe).
 * Zero personal info or mature content.
 *
 * Usage:
 *   node scripts/render-covers.mjs [--hero assets/showcase/honkai3-frame-b.png]
 *   node scripts/render-covers.mjs --smoke
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const CANDIDATE_BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const HERO_CANDIDATES = [
  'assets/showcase/honkai3-frame-b.png',
  'assets/showcase/honkai3-frame-a.png',
  'assets/showcase/honkai3-frame-c.png',
  'assets/showcase/honkai3-poster.png',
];

// Tuned for `崩坏3周年庆（动态）` (`honkai3-frame-b.png`) so Mei, Kiana & Elysia shine cleanly
const COVER_TUNING = {
  bgPos16x9: '50% 22%',
  bgScale16x9: 1.02,
  bgPos4x3: '18% 18%',
  bgScale4x3: 1.03,
  hubBgPos: '50% 34%',
  bgBrightness: 1.02,
  bgContrast: 1.06,
  bgSaturate: 1.16,
};

function parseArgs(argv) {
  const opts = {
    hero: null,
    outDir: path.join(PROJECT_ROOT, 'covers'),
    smoke: false,
    allowPlaceholder: false,
    bgPos16x9: COVER_TUNING.bgPos16x9,
    bgPos4x3: COVER_TUNING.bgPos4x3,
    hubBgPos: COVER_TUNING.hubBgPos,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hero' && argv[i + 1]) opts.hero = argv[++i];
    else if (a === '--out-dir' && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
    else if (a === '--bg-pos-16x9' && argv[i + 1]) opts.bgPos16x9 = argv[++i];
    else if (a === '--bg-pos-4x3' && argv[i + 1]) opts.bgPos4x3 = argv[++i];
    else if (a === '--hub-bg-pos' && argv[i + 1]) opts.hubBgPos = argv[++i];
    else if (a === '--smoke') opts.smoke = true;
    else if (a === '--allow-placeholder') opts.allowPlaceholder = true;
  }
  return opts;
}

function findBrowserExecutable() {
  for (const p of CANDIDATE_BROWSERS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Neither chrome.exe nor msedge.exe found in standard Windows paths.');
}

function resolveHeroPath(explicitHero) {
  if (explicitHero) {
    const abs = path.isAbsolute(explicitHero) ? explicitHero : path.resolve(PROJECT_ROOT, explicitHero);
    if (!fs.existsSync(abs)) {
      throw new Error(`Hero image not found: ${abs}`);
    }
    return abs;
  }
  for (const rel of HERO_CANDIDATES) {
    const abs = path.join(PROJECT_ROOT, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function findSystemFont(filename) {
  const winDir = process.env.WINDIR || 'C:\\Windows';
  const candidate = path.join(winDir, 'Fonts', filename);
  return fs.existsSync(candidate) ? candidate : null;
}

function readPngDimensions(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('Invalid PNG header');
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

class PipeTransport {
  constructor(writeStream, readStream) {
    this.writeStream = writeStream;
    this.readStream = readStream;
    this.seq = 0;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.buffer = '';

    this.readStream.setEncoding('utf8');
    this.readStream.on('data', (chunk) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf('\0')) !== -1) {
        const raw = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        if (!raw) continue;
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          continue;
        }
        this._handleMessage(msg);
      }
    });
  }

  _handleMessage(msg) {
    if (msg.id) {
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(`${entry.method}: ${msg.error.message || JSON.stringify(msg.error)}`));
        } else {
          entry.resolve(msg.result);
        }
      }
      return;
    }
    if (msg.method) {
      for (const fn of [...this.eventListeners]) fn(msg);
    }
  }

  onEvent(fn) {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 20000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout on ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
      this.writeStream.write(JSON.stringify(payload) + '\0');
    });
  }

  close() {
    for (const [, p] of this.pending) p.reject(new Error('CDP pipe closed'));
    this.pending.clear();
  }
}

class CdpPage {
  constructor(transport, sessionId, targetId) {
    this.transport = transport;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.listeners = new Map();
    this.requestHandler = null;
    this.consoleErrors = [];
    this.pageExceptions = [];

    this._off = this.transport.onEvent((msg) => {
      if (msg.sessionId !== this.sessionId) return;
      const { method, params } = msg;
      if (method === 'Runtime.consoleAPICalled' && params?.type === 'error') {
        const text = (params?.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        this.consoleErrors.push(text);
      } else if (method === 'Runtime.exceptionThrown') {
        const d = params?.exceptionDetails;
        this.pageExceptions.push(d?.exception?.description || d?.text || 'Exception');
      } else if (method === 'Fetch.requestPaused' && this.requestHandler) {
        this._handleFetch(params).catch(() => {});
      }
      const set = this.listeners.get(method);
      if (set) {
        for (const fn of [...set]) fn(params);
      }
    });
  }

  async _handleFetch(params) {
    const { requestId, request } = params;
    try {
      const reply = await this.requestHandler(request.url);
      if (!reply) {
        await this.call('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' });
        return;
      }
      const responseHeaders = Object.entries(reply.headers || {}).map(([name, value]) => ({
        name,
        value: String(value),
      }));
      const bodyBuf = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(String(reply.body || ''), 'utf8');
      await this.call('Fetch.fulfillRequest', {
        requestId,
        responseCode: reply.status || 200,
        responseHeaders,
        body: bodyBuf.toString('base64'),
      });
    } catch (err) {
      try {
        await this.call('Fetch.fulfillRequest', {
          requestId,
          responseCode: 500,
          responseHeaders: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }],
          body: Buffer.from(String(err?.message || err), 'utf8').toString('base64'),
        });
      } catch {}
    }
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }

  call(method, params = {}, timeoutMs = 20000) {
    return this.transport.send(method, params, this.sessionId, timeoutMs);
  }

  async navigate(url) {
    const loaded = new Promise((resolve) => {
      const off = this.on('Page.loadEventFired', () => {
        off();
        resolve();
      });
      setTimeout(() => {
        off();
        resolve();
      }, 15000);
    });
    await this.call('Page.navigate', { url });
    await loaded;
  }

  async evaluate(expression) {
    const res = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval failed');
    }
    return res.result?.value;
  }

  async capturePng(outPath, expectedWidth, expectedHeight) {
    const res = await this.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const buf = Buffer.from(res.data, 'base64');
    const dims = readPngDimensions(buf);
    if (dims.width !== expectedWidth || dims.height !== expectedHeight) {
      throw new Error(
        `PNG dimension mismatch for ${path.basename(outPath)}: got ${dims.width}x${dims.height}, expected ${expectedWidth}x${expectedHeight}`,
      );
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    return { path: outPath, width: dims.width, height: dims.height, bytes: buf.length };
  }

  dispose() {
    this._off?.();
    this.listeners.clear();
  }
}

async function launchBrowser({ width, height }) {
  const exe = findBrowserExecutable();
  const userDataDir = path.join(
    os.tmpdir(),
    `agy-cover-render-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  fs.mkdirSync(userDataDir, { recursive: true });

  const proc = spawn(
    exe,
    [
      '--headless=new',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-pipe',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] },
  );

  proc.stderr.on('data', () => {});
  const transport = new PipeTransport(proc.stdio[3], proc.stdio[4]);
  const version = await transport.send('Browser.getVersion');

  async function openPage({ width: w, height: h, requestHandler }) {
    const { targetId } = await transport.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await transport.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new CdpPage(transport, sessionId, targetId);
    await page.call('Page.enable');
    await page.call('Runtime.enable');
    await page.call('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: w,
      screenHeight: h,
    });
    if (requestHandler) {
      page.requestHandler = requestHandler;
      await page.call('Fetch.enable', { patterns: [{ urlPattern: 'http://cover.local/*' }] });
    }
    return page;
  }

  async function closePage(page) {
    if (!page) return;
    const tid = page.targetId;
    page.dispose();
    try {
      await transport.send('Target.closeTarget', { targetId: tid });
    } catch {}
  }

  async function close() {
    try {
      await transport.send('Browser.close', {}, undefined, 1500);
    } catch {}
    transport.close();
    for (const s of proc.stdio || []) {
      try {
        s?.destroy?.();
      } catch {}
    }
    try {
      proc.kill();
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }

  return { exe, version, openPage, closePage, close };
}

function buildPrismLogoSvg(size = 26, idSuffix = 'a') {
  return `<svg viewBox="0 0 256 256" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="pf_${idSuffix}" x1="36" y1="30" x2="220" y2="226" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#1E2436"/><stop offset="52%" stop-color="#121521"/><stop offset="100%" stop-color="#0B0D14"/>
      </linearGradient>
      <linearGradient id="pr_${idSuffix}" x1="32" y1="28" x2="224" y2="228" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#93C5FD" stop-opacity="0.95"/><stop offset="50%" stop-color="#C084FC" stop-opacity="0.78"/><stop offset="100%" stop-color="#50A37B" stop-opacity="0.88"/>
      </linearGradient>
      <linearGradient id="fl_${idSuffix}" x1="72" y1="62" x2="128" y2="196" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#93C5FD"/><stop offset="100%" stop-color="#3B82F6" stop-opacity="0.82"/>
      </linearGradient>
      <linearGradient id="fr_${idSuffix}" x1="128" y1="62" x2="188" y2="196" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#E9D5FF"/><stop offset="55%" stop-color="#7AA2F7"/><stop offset="100%" stop-color="#50A37B"/>
      </linearGradient>
    </defs>
    <rect x="20" y="20" width="216" height="216" rx="52" fill="url(#pf_${idSuffix})" stroke="url(#pr_${idSuffix})" stroke-width="9"/>
    <path d="M40 140L106 122" stroke="#E2E8F0" stroke-opacity="0.92" stroke-width="8" stroke-linecap="round"/>
    <path d="M150 114L214 94" stroke="#67E8F9" stroke-width="8" stroke-linecap="round"/>
    <path d="M154 128L216 128" stroke="#C084FC" stroke-width="8" stroke-linecap="round"/>
    <path d="M150 142L212 162" stroke="#50A37B" stroke-width="8" stroke-linecap="round"/>
    <polygon points="128,54 74,132 128,202" fill="url(#fl_${idSuffix})"/>
    <polygon points="128,54 182,132 128,202" fill="url(#fr_${idSuffix})"/>
    <polygon points="128,54 100,132 128,156 156,132" fill="#FFFFFF" fill-opacity="0.34"/>
    <polygon points="128,54 74,132 128,202 182,132" stroke="#F8FAFC" stroke-opacity="0.96" stroke-width="5" stroke-linejoin="round"/>
  </svg>`;
}

/**
 * Generates the self-contained HTML document for either '16x9' (1920x1080) or '4x3' (1600x1200).
 * Both aspect ratios have bespoke art-directed compositions — never a center-crop!
 */
function buildCoverHtml({ variant, hasNotoFont, hasConsolasFont, bgPos, bgScale, hubBgPos, heroUrl }) {
  const is16x9 = variant === '16x9';
  const W = is16x9 ? 1920 : 1600;
  const H = is16x9 ? 1080 : 1200;

  const fontFaceCss = `
    ${hasNotoFont ? `@font-face {
      font-family: 'PrismSans';
      src: url('/fonts/noto-sans-sc.ttf') format('truetype');
      font-weight: 100 900;
      font-style: normal;
      font-display: block;
    }` : ''}
    ${hasConsolasFont ? `@font-face {
      font-family: 'PrismMono';
      src: url('/fonts/consolab.ttf') format('truetype');
      font-weight: 700;
      font-style: normal;
      font-display: block;
    }` : ''}
  `;

  const hubMarkup = `
    <div class="hub-scene">
      <div class="hub-ambient-glow"></div>
      <div class="hub-frame">
        <!-- Vivid Honkai 3rd wallpaper inside the 3D Hub stage so Floating Islands genuinely blur & reveal it across every 11px gap -->
        <div class="hub-wallpaper-layer">
          ${heroUrl
            ? `<img class="hub-bg-img" src="${heroUrl}" alt="" />`
            : `<div class="hub-bg-placeholder"></div>`}
          <div class="hub-bg-scrim"></div>
        </div>

        <!-- True Obsidian Prism Floating Islands Layout -->
        <div class="hub-islands">
          <!-- Island 1: Top Glass Command Bar -->
          <div class="island island-topbar">
            <div class="traffic-dots">
              <span class="dot d-red"></span>
              <span class="dot d-amber"></span>
              <span class="dot d-green"></span>
            </div>
            <div class="topbar-title">
              ${buildPrismLogoSvg(20, 'tb')}
              <span class="topbar-brand">Antigravity</span>
              <span class="topbar-sep">/</span>
              <span class="topbar-ws">agy-wallpaper-prism</span>
            </div>
            <div class="topbar-pills">
              <span class="mini-pill pill-cyan">浮岛画境 Islands</span>
              <span class="mini-pill pill-emerald">● 60 FPS</span>
            </div>
          </div>

          <!-- Lower Body: Left Sidebar Island + Main Code/Workbench Island -->
          <div class="hub-body">
            <!-- Island 2: Left Sidebar & Active Live Wallpaper Card -->
            <div class="island island-sidebar">
              <div class="sb-section-label">LIVE WALLPAPER</div>
              <div class="sb-wp-card">
                <div class="sb-wp-thumb">
                  ${heroUrl ? `<img src="${heroUrl}" alt="" />` : `<div class="sb-wp-fallback"></div>`}
                  <span class="sb-live-badge">LIVE</span>
                </div>
                <div class="sb-wp-meta">
                  <div class="sb-wp-name">崩坏3周年庆（动态）</div>
                  <div class="sb-wp-sub">Steam 431960 · 4K60</div>
                </div>
              </div>

              <div class="sb-section-label" style="margin-top:12px;">WORKSPACES</div>
              <div class="sb-item sb-active">
                <span class="sb-dot c-cyan"></span>
                <span>agy-wallpaper-prism</span>
              </div>
              <div class="sb-item">
                <span class="sb-dot c-violet"></span>
                <span>obsidian-prism-ui</span>
              </div>
              <div class="sb-item">
                <span class="sb-dot c-emerald"></span>
                <span>steam-workshop-vfs</span>
              </div>

              <div class="sb-schemes">
                <span class="scheme-label">8 Schemes</span>
                <div class="scheme-dots">
                  <i style="background:#669DF6;box-shadow:0 0 8px #669DF6;"></i>
                  <i style="background:#D97757;"></i>
                  <i style="background:#CBA6F7;"></i>
                  <i style="background:#88C0D0;"></i>
                  <i style="background:#F472B6;"></i>
                  <i style="background:#50A37B;"></i>
                </div>
              </div>
            </div>

            <!-- Island 3: Main Translucent Code & Prism Stage Island -->
            <div class="island island-main">
              <div class="editor-tabs">
                <div class="ed-tab ed-tab-active">
                  <span class="tab-gem">◆</span>
                  <span>prism-skin.ts</span>
                </div>
                <div class="ed-tab">wallpaper-stage.glsl</div>
                <div class="ed-spacer"></div>
                <div class="ed-chip">WCAG AAA</div>
              </div>

              <div class="code-surface">
                <div class="code-line"><span class="ln">01</span><span class="code-text"><span class="cm">// Obsidian Prism · 6-Tier Glass Skin</span></span></div>
                <div class="code-line"><span class="ln">02</span><span class="code-text"><span class="kw">const</span> <span class="id">prism</span> <span class="op">=</span> <span class="kw">await</span> <span class="fn">WallpaperPrism</span>.<span class="fn">mount</span>({</span></div>
                <div class="code-line"><span class="ln">03</span><span class="code-text">  <span class="pr">source</span>: <span class="st">"Steam 创意工坊 · 431960"</span>,</span></div>
                <div class="code-line"><span class="ln">04</span><span class="code-text">  <span class="pr">layout</span>: <span class="st">"floating-islands"</span>, <span class="cm">// 8px 浮岛间距</span></span></div>
                <div class="code-line"><span class="ln">05</span><span class="code-text">  <span class="pr">accent</span>: <span class="fn">chroma32x32</span>(<span class="st">"honkai3-live"</span>),</span></div>
                <div class="code-line"><span class="ln">06</span><span class="code-text">  <span class="pr">asarPatch</span>: <span class="bo">false</span>, <span class="cm">// 零修改 app.asar</span></span></div>
                <div class="code-line"><span class="ln">07</span><span class="code-text">});</span></div>
              </div>

              <div class="hub-footer-strip">
                <div class="metric-chip"><span class="m-val">2.5ms</span> 瞬切</div>
                <div class="metric-chip"><span class="m-val">0</span> Agent Token</div>
                <div class="metric-chip prism-pill-trigger">◆ Prism</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 172deg optical specular Fresnel sheen -->
        <div class="hub-sheen"></div>
      </div>

      <!-- Z-Lifted Quick Prism Popover + Ctrl+Alt+W Tactile Keycaps -->
      <div class="quick-prism-card">
        <div class="qp-header">
          <div class="qp-brand">
            ${buildPrismLogoSvg(24, 'qp')}
            <span>Quick Prism</span>
          </div>
          <div class="qp-keys">
            <kbd>Ctrl</kbd><span class="kplus">+</span><kbd>Alt</kbd><span class="kplus">+</span><kbd>W</kbd>
          </div>
        </div>
        <div class="qp-row">
          <span class="qp-tag qp-tag-on">浮岛画境</span>
          <span class="qp-tag">紧凑一体</span>
          <span class="qp-tag">Nord 浅霜</span>
        </div>
        <div class="qp-slider-row">
          <span class="qp-lbl">玻璃通透</span>
          <div class="qp-bar"><div class="qp-fill" style="width:76%;"></div></div>
          <span class="qp-num">76%</span>
        </div>
        <div class="qp-chroma-row">
          <span class="qp-lbl">动态取色</span>
          <div class="qp-spectrum"></div>
        </div>
      </div>
    </div>
  `;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  ${fontFaceCss}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${W}px;
    height: ${H}px;
    overflow: hidden;
    background: #070912;
    font-family: 'PrismSans', 'Noto Sans SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  .canvas-root {
    position: relative;
    width: ${W}px;
    height: ${H}px;
    overflow: hidden;
    background: #070912;
  }

  /* Layer 0: Radiant full-bleed Honkai 3rd Anniversary hero still */
  .hero-bg-wrap {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: hidden;
  }
  .hero-bg-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: ${bgPos};
    transform: scale(${bgScale});
    filter: brightness(${COVER_TUNING.bgBrightness}) contrast(${COVER_TUNING.bgContrast}) saturate(${COVER_TUNING.bgSaturate});
  }
  .hero-bg-placeholder {
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #102048 0%, #2a1d54 48%, #153458 100%);
  }

  /* Layer 1: Sculpted, localized contrast scrim — keeps Mei, Kiana & Elysia radiant! */
  .hero-scrim {
    position: absolute;
    inset: 0;
    z-index: 2;
    background: ${is16x9 ? `
      radial-gradient(ellipse 56% 52% at 24% 48%, rgba(7, 10, 24, 0.72) 0%, rgba(8, 12, 28, 0.44) 55%, transparent 100%),
      linear-gradient(90deg, rgba(6, 9, 22, 0.64) 0%, rgba(8, 12, 28, 0.30) 34%, rgba(8, 12, 28, 0.04) 58%, rgba(8, 10, 24, 0.22) 100%),
      linear-gradient(180deg, rgba(6, 9, 22, 0.24) 0%, transparent 18%, transparent 74%, rgba(5, 8, 20, 0.66) 100%)
    ` : `
      linear-gradient(180deg, rgba(7, 10, 26, 0.68) 0%, rgba(8, 12, 30, 0.48) 25%, rgba(10, 14, 34, 0.08) 46%, rgba(8, 12, 28, 0.14) 76%, rgba(5, 8, 20, 0.72) 100%),
      radial-gradient(ellipse 84% 34% at 44% 22%, rgba(6, 9, 24, 0.48) 0%, transparent 82%)
    `};
  }

  /* Layer 2: WebGL2 (with Canvas2D fallback) Prismatic Light Beams, Caustics & Bokeh */
  #prism-fx {
    position: absolute;
    inset: 0;
    width: ${W}px;
    height: ${H}px;
    z-index: 4;
    pointer-events: none;
  }

  /* Layer 3: Razor-sharp Diagonal Prism Refraction Light Shafts & Fresnel Glints */
  .prism-svg-overlay {
    position: absolute;
    inset: 0;
    width: ${W}px;
    height: ${H}px;
    z-index: 5;
    pointer-events: none;
  }

  /* =====================================================================
   * 3D Obsidian Prism Floating Islands Antigravity Hub Showcase Window
   * ===================================================================== */
  .hub-scene {
    position: absolute;
    z-index: 10;
    ${is16x9 ? `
      right: 66px;
      top: 196px;
      width: 842px;
      height: 582px;
    ` : `
      left: 72px;
      top: 472px;
      width: 1110px;
      height: 544px;
    `}
    perspective: 1900px;
  }

  .hub-ambient-glow {
    position: absolute;
    inset: -32px;
    border-radius: 40px;
    background:
      radial-gradient(circle at 18% 15%, rgba(103, 232, 249, 0.52), transparent 48%),
      radial-gradient(circle at 86% 84%, rgba(216, 180, 254, 0.50), transparent 52%),
      radial-gradient(circle at 50% 50%, rgba(96, 165, 250, 0.24), transparent 64%);
    filter: blur(34px);
    opacity: 0.92;
  }

  .hub-frame {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 26px;
    overflow: hidden;
    transform: ${is16x9
      ? 'rotateY(-10.5deg) rotateX(3.8deg) rotateZ(-0.9deg)'
      : 'rotateX(5.2deg) rotateY(-4.8deg) rotateZ(-0.5deg)'};
    transform-style: preserve-3d;
    border: 1.8px solid rgba(235, 248, 255, 0.72);
    box-shadow:
      0 38px 86px rgba(4, 7, 22, 0.76),
      0 14px 32px rgba(0, 0, 0, 0.56),
      0 0 0 1px rgba(103, 232, 249, 0.34),
      0 0 36px rgba(125, 211, 252, 0.22),
      inset 0 2px 0 rgba(255, 255, 255, 0.78),
      inset 1.5px 0 0 rgba(165, 225, 255, 0.45);
    background: #101628;
  }

  .hub-wallpaper-layer {
    position: absolute;
    inset: 0;
    z-index: 1;
  }
  .hub-bg-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: ${hubBgPos};
    filter: brightness(1.06) contrast(1.06) saturate(1.24);
  }
  .hub-bg-placeholder {
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #2563eb, #a855f7 52%, #f472b6);
  }
  .hub-bg-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(160deg, rgba(10, 14, 30, 0.04) 0%, rgba(8, 12, 26, 0.14) 100%);
  }

  /* True Floating Islands: generous 13px outer margin & 11px gaps revealing crystal-sharp anime wallpaper */
  .hub-islands {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 11px;
  }

  /* Authentic Translucent Obsidian Prism Frosted Glass Islands */
  .island {
    position: relative;
    border-radius: 16px;
    background: linear-gradient(168deg, rgba(16, 20, 38, 0.44) 0%, rgba(10, 13, 26, 0.56) 100%);
    backdrop-filter: blur(18px) saturate(190%);
    -webkit-backdrop-filter: blur(18px) saturate(190%);
    border: 1.2px solid rgba(255, 255, 255, 0.32);
    box-shadow:
      inset 0 1.5px 0 rgba(255, 255, 255, 0.58),
      inset 1px 0 0 rgba(186, 230, 253, 0.28),
      0 10px 26px rgba(4, 6, 18, 0.34);
    overflow: hidden;
  }

  .island-topbar {
    height: 50px;
    flex: 0 0 50px;
    padding: 0 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(168deg, rgba(18, 23, 44, 0.52) 0%, rgba(11, 15, 30, 0.62) 100%);
  }

  .traffic-dots { display: flex; gap: 8px; align-items: center; }
  .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  .d-red { background: #FF5F57; box-shadow: 0 0 8px rgba(255, 95, 87, 0.65); }
  .d-amber { background: #FEBC2E; box-shadow: 0 0 8px rgba(254, 188, 46, 0.65); }
  .d-green { background: #28C840; box-shadow: 0 0 8px rgba(40, 200, 64, 0.65); }

  .topbar-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #FFFFFF;
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.01em;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.72);
  }
  .topbar-sep { color: rgba(255, 255, 255, 0.45); }
  .topbar-ws { color: #BAE6FD; font-weight: 700; }

  .topbar-pills { display: flex; gap: 8px; align-items: center; }
  .mini-pill {
    font-size: 13px;
    font-weight: 800;
    padding: 4px 11px;
    border-radius: 999px;
    letter-spacing: 0.02em;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  }
  .pill-cyan {
    background: rgba(56, 189, 248, 0.30);
    border: 1px solid rgba(186, 230, 253, 0.62);
    color: #F0F9FF;
  }
  .pill-emerald {
    background: rgba(16, 185, 129, 0.32);
    border: 1px solid rgba(110, 231, 183, 0.62);
    color: #ECFDF5;
  }

  .hub-body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 11px;
  }

  .island-sidebar {
    width: ${is16x9 ? '244px' : '278px'};
    flex: 0 0 ${is16x9 ? '244px' : '278px'};
    padding: 14px 13px;
    display: flex;
    flex-direction: column;
  }

  .sb-section-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: rgba(226, 238, 255, 0.78);
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
    margin-bottom: 8px;
  }

  .sb-wp-card {
    border-radius: 12px;
    overflow: hidden;
    border: 1.2px solid rgba(186, 230, 253, 0.56);
    background: rgba(10, 14, 28, 0.56);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.32);
  }
  .sb-wp-thumb {
    position: relative;
    height: ${is16x9 ? '106px' : '102px'};
    overflow: hidden;
  }
  .sb-wp-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 25%;
  }
  .sb-wp-fallback {
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #3b82f6, #a855f7);
  }
  .sb-live-badge {
    position: absolute;
    top: 7px;
    right: 7px;
    font-size: 11px;
    font-weight: 900;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(16, 185, 129, 0.94);
    color: #031B13;
    letter-spacing: 0.06em;
  }
  .sb-wp-meta {
    padding: 8px 10px 9px;
  }
  .sb-wp-name {
    font-size: 14.5px;
    font-weight: 800;
    color: #FFFFFF;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sb-wp-sub {
    font-size: 12px;
    font-weight: 700;
    color: #BAE6FD;
    margin-top: 2px;
  }

  .sb-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 700;
    color: rgba(241, 245, 249, 0.90);
    text-shadow: 0 1px 5px rgba(0, 0, 0, 0.72);
    margin-bottom: 5px;
  }
  .sb-active {
    background: linear-gradient(90deg, rgba(56, 189, 248, 0.34), rgba(168, 85, 247, 0.20));
    border: 1px solid rgba(186, 230, 253, 0.54);
    color: #FFFFFF;
  }
  .sb-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; }
  .c-cyan { background: #67E8F9; box-shadow: 0 0 8px #67E8F9; }
  .c-violet { background: #D8B4FE; box-shadow: 0 0 8px #D8B4FE; }
  .c-emerald { background: #34D399; box-shadow: 0 0 8px #34D399; }

  .sb-schemes {
    margin-top: auto;
    padding-top: 9px;
    border-top: 1px solid rgba(255, 255, 255, 0.18);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .scheme-label { font-size: 12px; font-weight: 800; color: rgba(241, 245, 249, 0.88); text-shadow: 0 1px 4px rgba(0,0,0,0.7); }
  .scheme-dots { display: flex; gap: 6px; }
  .scheme-dots i {
    display: block;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.82);
  }

  .island-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 13px 15px;
  }

  .editor-tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.18);
  }
  .ed-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 13px;
    border-radius: 9px;
    font-size: 14px;
    font-weight: 700;
    color: rgba(226, 232, 240, 0.78);
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
  }
  .ed-tab-active {
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(186, 230, 253, 0.52);
    color: #FFFFFF;
  }
  .tab-gem { color: #67E8F9; font-size: 12px; }
  .ed-spacer { flex: 1; }
  .ed-chip {
    font-size: 12px;
    font-weight: 800;
    padding: 4px 10px;
    border-radius: 8px;
    background: rgba(168, 85, 247, 0.34);
    border: 1px solid rgba(233, 213, 255, 0.56);
    color: #FAF5FF;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  }

  /* Translucent WCAG AAA code surface letting anime prism colors breathe behind crisp luminous syntax */
  .code-surface {
    flex: 1;
    margin-top: 12px;
    padding: 16px 18px;
    border-radius: 13px;
    background: linear-gradient(155deg, rgba(10, 14, 28, 0.44) 0%, rgba(8, 10, 22, 0.52) 100%);
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
    font-family: 'PrismMono', 'Cascadia Code', 'Consolas', monospace;
    font-size: ${is16x9 ? '17.5px' : '20px'};
    line-height: 1.72;
    font-weight: 700;
    color: #F8FAFC;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-shadow: 0 1.5px 6px rgba(2, 4, 14, 0.92);
  }
  .code-line {
    display: flex;
    align-items: baseline;
  }
  .ln {
    display: inline-block;
    width: 34px;
    flex: 0 0 34px;
    color: rgba(186, 210, 240, 0.58);
    font-size: 0.82em;
    user-select: none;
  }
  .code-text {
    white-space: pre;
  }
  .cm { color: #B2C7E0; font-style: italic; font-family: 'PrismSans', 'Noto Sans SC', 'Microsoft YaHei', sans-serif; font-weight: 600; font-size: 0.88em; }
  .kw { color: #E9D5FF; }
  .id { color: #FFFFFF; }
  .op { color: #67E8F9; }
  .fn { color: #7DD3FC; }
  .pr { color: #BAE6FD; }
  .st { color: #6EE7B7; font-family: 'PrismMono', 'PrismSans', 'Noto Sans SC', 'Microsoft YaHei', monospace; }
  .bo { color: #FDE047; }

  .hub-footer-strip {
    margin-top: 11px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .metric-chip {
    padding: 6px 13px;
    border-radius: 10px;
    background: rgba(12, 16, 32, 0.52);
    border: 1px solid rgba(255, 255, 255, 0.24);
    color: #F1F5F9;
    font-size: 14px;
    font-weight: 700;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.72);
  }
  .m-val { color: #67E8F9; font-weight: 900; margin-right: 3px; }
  .prism-pill-trigger {
    margin-left: auto;
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.46), rgba(168, 85, 247, 0.44));
    border: 1px solid rgba(224, 242, 254, 0.78);
    color: #FFFFFF;
    box-shadow: 0 0 18px rgba(102, 157, 246, 0.45);
  }

  .hub-sheen {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.04) 24%, transparent 48%, rgba(216, 180, 254, 0.10) 100%);
  }

  /* Z-Lifted Quick Prism Popover + Ctrl+Alt+W Card (Zero collision with Hub badges or duration zone!) */
  .quick-prism-card {
    position: absolute;
    z-index: 20;
    ${is16x9 ? `
      left: -118px;
      bottom: -74px;
      width: 356px;
    ` : `
      right: -348px;
      top: 232px;
      width: 372px;
    `}
    padding: 17px 19px;
    border-radius: 20px;
    background: linear-gradient(158deg, rgba(16, 21, 40, 0.84) 0%, rgba(9, 12, 24, 0.92) 100%);
    backdrop-filter: blur(26px) saturate(185%);
    -webkit-backdrop-filter: blur(26px) saturate(185%);
    border: 1.6px solid rgba(186, 230, 253, 0.72);
    box-shadow:
      0 26px 56px rgba(3, 5, 18, 0.82),
      0 0 38px rgba(102, 157, 246, 0.34),
      inset 0 1.5px 0 rgba(255, 255, 255, 0.68);
    transform: ${is16x9 ? 'rotateZ(-1.4deg)' : 'rotateZ(1.5deg)'};
  }

  .qp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 13px;
  }
  .qp-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #FFFFFF;
    font-size: 16.5px;
    font-weight: 800;
  }
  .qp-keys {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .qp-keys kbd {
    display: inline-block;
    padding: 4px 9px;
    border-radius: 7px;
    font-family: 'PrismMono', 'Consolas', monospace;
    font-size: 14px;
    font-weight: 800;
    color: #FFFFFF;
    background: linear-gradient(180deg, rgba(64, 88, 138, 0.96), rgba(26, 34, 58, 0.98));
    border: 1.2px solid rgba(186, 230, 253, 0.75);
    box-shadow: 0 3px 0 rgba(6, 10, 24, 0.92), inset 0 1px 0 rgba(255, 255, 255, 0.55);
  }
  .kplus { color: rgba(186, 230, 253, 0.88); font-size: 13px; font-weight: 900; }

  .qp-row {
    display: flex;
    gap: 7px;
    margin-bottom: 12px;
  }
  .qp-tag {
    flex: 1;
    text-align: center;
    padding: 6px 6px;
    border-radius: 9px;
    font-size: 13.5px;
    font-weight: 700;
    color: rgba(226, 232, 240, 0.85);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.16);
  }
  .qp-tag-on {
    color: #FFFFFF;
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.48), rgba(168, 85, 247, 0.42));
    border-color: rgba(186, 230, 253, 0.78);
    box-shadow: 0 0 14px rgba(56, 189, 248, 0.36);
  }

  .qp-slider-row, .qp-chroma-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 9px;
  }
  .qp-lbl {
    width: 64px;
    font-size: 13.5px;
    font-weight: 700;
    color: rgba(226, 232, 240, 0.92);
  }
  .qp-bar {
    flex: 1;
    height: 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
    overflow: hidden;
  }
  .qp-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #38BDF8, #818CF8, #E879F9);
    box-shadow: 0 0 12px rgba(103, 232, 249, 0.72);
  }
  .qp-num {
    width: 38px;
    text-align: right;
    font-size: 13.5px;
    font-weight: 800;
    color: #7DD3FC;
    font-family: 'PrismMono', 'Consolas', monospace;
  }
  .qp-spectrum {
    flex: 1;
    height: 10px;
    border-radius: 999px;
    background: linear-gradient(90deg, #38BDF8 0%, #669DF6 25%, #A58AF8 52%, #F472B6 76%, #50A37B 100%);
    box-shadow: 0 0 12px rgba(165, 138, 248, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.38);
  }

  /* =====================================================================
   * High-CTR Editorial Typography & Badges (Crystal-Clear at 240px!)
   * ===================================================================== */
  .top-bar {
    position: absolute;
    z-index: 25;
    top: ${is16x9 ? '60px' : '58px'};
    left: ${is16x9 ? '68px' : '68px'};
    right: ${is16x9 ? '68px' : '68px'};
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .top-pills {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .pill-primary {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 11px 25px 11px 16px;
    border-radius: 999px;
    background: linear-gradient(135deg, rgba(11, 15, 30, 0.86), rgba(20, 26, 50, 0.80));
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    border: 1.6px solid rgba(186, 230, 253, 0.72);
    box-shadow:
      0 12px 30px rgba(0, 0, 0, 0.52),
      0 0 26px rgba(56, 189, 248, 0.30),
      inset 0 1.5px 0 rgba(255, 255, 255, 0.56);
    color: #FFFFFF;
    font-size: ${is16x9 ? '28px' : '27px'};
    font-weight: 800;
    letter-spacing: 0.03em;
  }

  .pill-mambo {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 11px 23px;
    border-radius: 999px;
    background: linear-gradient(135deg, rgba(219, 39, 119, 0.54), rgba(245, 158, 11, 0.44));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1.6px solid rgba(253, 230, 138, 0.78);
    box-shadow:
      0 10px 26px rgba(40, 8, 28, 0.52),
      0 0 24px rgba(244, 114, 182, 0.36),
      inset 0 1.5px 0 rgba(255, 255, 255, 0.58);
    color: #FFFFFF;
    font-size: ${is16x9 ? '26px' : '25px'};
    font-weight: 800;
    letter-spacing: 0.04em;
    text-shadow: 0 2px 10px rgba(96, 12, 52, 0.85);
  }
  .mambo-spark {
    color: #FEF08A;
    font-size: 25px;
    filter: drop-shadow(0 0 8px rgba(254, 240, 138, 0.95));
  }

  .top-right-chip {
    display: ${is16x9 ? 'none' : 'inline-flex'};
    align-items: center;
    gap: 10px;
    padding: 11px 22px;
    border-radius: 999px;
    background: rgba(11, 15, 30, 0.82);
    backdrop-filter: blur(16px);
    border: 1.5px solid rgba(216, 180, 254, 0.62);
    color: #F5F3FF;
    font-size: 24px;
    font-weight: 800;
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.42);
  }

  /* Giant High-Contrast Hero Headline (clean breathing gap before 3D Hub window!) */
  .headline-block {
    position: absolute;
    z-index: 26;
    ${is16x9 ? `
      left: 66px;
      top: 256px;
      width: 890px;
    ` : `
      left: 68px;
      top: 152px;
      right: 68px;
    `}
  }

  .hl-line {
    position: relative;
    display: block;
    line-height: 1.13;
    letter-spacing: -0.015em;
    white-space: nowrap;
  }

  /* Refined editorial dark obsidian aura + razor-sharp luminous specular text */
  .hl-line-1 {
    font-size: ${is16x9 ? '100px' : '116px'};
    font-weight: 900;
    margin-bottom: ${is16x9 ? '18px' : '12px'};
  }
  .hl-line-1 .hl-back {
    position: absolute;
    inset: 0;
    color: #060A18;
    -webkit-text-stroke: 8px rgba(6, 10, 24, 0.92);
    text-shadow:
      0 10px 28px rgba(4, 6, 18, 0.98),
      0 4px 12px rgba(2, 4, 14, 0.96),
      0 0 44px rgba(5, 9, 24, 0.86),
      0 0 56px rgba(56, 189, 248, 0.42);
    user-select: none;
  }
  .hl-line-1 .hl-front {
    position: relative;
    color: #FFFFFF;
    background: linear-gradient(180deg, #FFFFFF 0%, #F4F9FF 64%, #C7E3FF 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .hl-line-2 {
    font-size: ${is16x9 ? '85px' : '102px'};
    font-weight: 900;
  }
  .hl-line-2 .hl-back {
    position: absolute;
    inset: 0;
    color: #060A18;
    -webkit-text-stroke: 8px rgba(6, 10, 24, 0.94);
    text-shadow:
      0 12px 32px rgba(4, 6, 18, 0.98),
      0 4px 12px rgba(2, 4, 14, 0.96),
      0 0 46px rgba(5, 9, 24, 0.88),
      0 0 56px rgba(192, 132, 252, 0.50);
    user-select: none;
  }
  .hl-line-2 .hl-front {
    position: relative;
    background: linear-gradient(92deg, #67E8F9 0%, #93C5FD 26%, #FFFFFF 50%, #E9D5FF 75%, #7DD3FC 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* Sleek Metric Sub-Ribbon (16:9 left editorial anchor) */
  .sub-ribbon {
    display: ${is16x9 ? 'inline-flex' : 'none'};
    align-items: center;
    gap: 15px;
    margin-top: 34px;
    padding: 13px 24px;
    border-radius: 16px;
    background: linear-gradient(90deg, rgba(10, 14, 28, 0.84) 0%, rgba(16, 22, 44, 0.72) 100%);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1.2px solid rgba(186, 230, 253, 0.45);
    border-left: 5px solid #67E8F9;
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.56);
    color: #F1F5F9;
    font-size: 28px;
    font-weight: 800;
    letter-spacing: 0.02em;
  }
  .sub-em { color: #67E8F9; font-weight: 900; }
  .sub-sep { color: rgba(216, 180, 254, 0.82); font-weight: 900; }

  /* Bottom Feature Badges — Left-Anchored, Strictly Outside Bottom-Right Bilibili Duration Safe Zone! */
  .bottom-badges {
    position: absolute;
    z-index: 26;
    left: ${is16x9 ? '68px' : '68px'};
    bottom: ${is16x9 ? '60px' : '58px'};
    display: flex;
    align-items: center;
    gap: ${is16x9 ? '18px' : '16px'};
  }

  .feat-badge {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: ${is16x9 ? '14px 25px' : '13px 23px'};
    border-radius: 16px;
    background: linear-gradient(155deg, rgba(11, 16, 30, 0.86) 0%, rgba(8, 11, 22, 0.92) 100%);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1.5px solid rgba(224, 242, 254, 0.36);
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.58),
      inset 0 1.2px 0 rgba(255, 255, 255, 0.48);
    color: #FFFFFF;
    font-size: ${is16x9 ? '29px' : '28px'};
    font-weight: 800;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .fb-dot {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    flex: 0 0 13px;
  }
  .fb-cyan { background: #38BDF8; box-shadow: 0 0 14px #38BDF8; }
  .fb-violet { background: #C084FC; box-shadow: 0 0 14px #C084FC; }
  .fb-emerald { background: #34D399; box-shadow: 0 0 14px #34D399; }

  .poster-frame-rim {
    position: absolute;
    inset: 14px;
    z-index: 30;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    pointer-events: none;
  }
</style>
</head>
<body>
  <div class="canvas-root">
    <!-- Layer 0: Radiant Honkai 3rd Anniversary Hero Backdrop -->
    <div class="hero-bg-wrap">
      ${heroUrl
        ? `<img class="hero-bg-img" src="${heroUrl}" alt="" />`
        : `<div class="hero-bg-placeholder"></div>`}
    </div>

    <!-- Layer 1: Sculpted Atmospheric Contrast Scrim -->
    <div class="hero-scrim"></div>

    <!-- Layer 2: WebGL2 (with Canvas2D fallback) Diagonal Prismatic Dispersion Beams & Crystal Bokeh -->
    <canvas id="prism-fx" width="${W}" height="${H}"></canvas>

    <!-- Layer 3: Razor-Sharp Diagonal Fresnel Prism Light Shafts & Specular Rim Rays -->
    <svg class="prism-svg-overlay" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="diagBeamA" x1="${is16x9 ? 1120 : 1240}" y1="0" x2="${is16x9 ? 540 : 380}" y2="${H}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#67E8F9" stop-opacity="0.30"/>
          <stop offset="45%" stop-color="#C084FC" stop-opacity="0.14"/>
          <stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="diagBeamB" x1="${W}" y1="${is16x9 ? 60 : 120}" x2="${is16x9 ? 940 : 620}" y2="${H}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.32"/>
          <stop offset="38%" stop-color="#E879F9" stop-opacity="0.14"/>
          <stop offset="100%" stop-color="#50A37B" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="rimRay" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.92"/>
          <stop offset="42%" stop-color="#7DD3FC" stop-opacity="0.58"/>
          <stop offset="100%" stop-color="#D8B4FE" stop-opacity="0"/>
        </linearGradient>
        <radialGradient id="prismStar" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>
          <stop offset="32%" stop-color="#BAE6FD" stop-opacity="0.52"/>
          <stop offset="100%" stop-color="#67E8F9" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <!-- Sweeping diagonal glass prism light beams framing (not covering!) Kiana & 3D Hub -->
      <polygon points="${is16x9
        ? '1080,0 1240,0 740,1080 560,1080'
        : '1120,0 1300,0 740,1200 540,1200'}" fill="url(#diagBeamA)"/>
      <polygon points="${is16x9
        ? '1620,0 1790,0 1320,1080 1160,1080'
        : '1420,0 1580,0 1140,1200 980,1200'}" fill="url(#diagBeamB)"/>
      <!-- Crisp Fresnel glass specular rays -->
      <line x1="${is16x9 ? 1080 : 1120}" y1="0" x2="${is16x9 ? 560 : 540}" y2="${H}" stroke="url(#rimRay)" stroke-width="2" opacity="0.62"/>
      <line x1="${is16x9 ? 1620 : 1420}" y1="0" x2="${is16x9 ? 1160 : 980}" y2="${H}" stroke="url(#rimRay)" stroke-width="1.6" opacity="0.48"/>
      <!-- Specular star glint on top-left corner of the 3D Hub bezel -->
      <circle cx="${is16x9 ? 1028 : 110}" cy="${is16x9 ? 214 : 494}" r="40" fill="url(#prismStar)" opacity="0.88"/>
      <path d="${is16x9
        ? 'M1028 168 L1032 210 L1074 214 L1032 218 L1028 260 L1024 218 L982 214 L1024 210 Z'
        : 'M110 452 L114 490 L152 494 L114 498 L110 536 L106 498 L68 494 L106 490 Z'}" fill="#FFFFFF" opacity="0.9"/>
    </svg>

    <!-- Layer 4: 3D Obsidian Prism Floating Islands Antigravity Hub Showcase Window -->
    ${hubMarkup}

    <!-- Layer 5: Top Pill Bar -->
    <div class="top-bar">
      <div class="top-pills">
        <div class="pill-primary">
          ${buildPrismLogoSvg(32, 'tp')}
          <span>开源 · Antigravity 插件</span>
        </div>
        <div class="pill-mambo">
          <span class="mambo-spark">✦</span>
          <span>曼波配音</span>
        </div>
      </div>
      <div class="top-right-chip">
        <span>◆ Obsidian Prism v1.1</span>
      </div>
    </div>

    <!-- Layer 6: Giant High-Contrast Chinese Hero Headline -->
    <div class="headline-block">
      <div class="hl-line hl-line-1">
        <span class="hl-back" aria-hidden="true">重塑 Antigravity！</span>
        <span class="hl-front">重塑 Antigravity！</span>
      </div>
      <div class="hl-line hl-line-2">
        <span class="hl-back" aria-hidden="true">动态壁纸 × 浮岛毛玻璃</span>
        <span class="hl-front">动态壁纸 × 浮岛毛玻璃</span>
      </div>
      <div class="sub-ribbon">
        <span class="sub-em">4K60</span> 流畅直出
        <span class="sub-sep">·</span>
        <span class="sub-em">2.5ms</span> 瞬切壁纸
        <span class="sub-sep">·</span>
        <span class="sub-em">0</span> Agent Token
      </div>
    </div>

    <!-- Layer 7: Bottom Feature Badges (Safely Clear of Bottom-Right Bilibili Duration Zone) -->
    <div class="bottom-badges">
      <div class="feat-badge"><span class="fb-dot fb-cyan"></span><span>Steam 创意工坊</span></div>
      <div class="feat-badge"><span class="fb-dot fb-violet"></span><span>Obsidian Prism UI</span></div>
      <div class="feat-badge"><span class="fb-dot fb-emerald"></span><span>零修改 app.asar</span></div>
    </div>

    <div class="poster-frame-rim"></div>
  </div>

  <script>
  (function renderOpticalPrismFx() {
    const canvas = document.getElementById('prism-fx');
    const W = canvas.width;
    const H = canvas.height;
    let renderer = 'canvas2d';

    function renderWebGL2() {
      const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
      if (!gl) return false;

      const vsSrc = \`#version 300 es
        in vec2 aPos;
        out vec2 vUv;
        void main() {
          vUv = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }
      \`;
      const fsSrc = \`#version 300 es
        precision highp float;
        in vec2 vUv;
        out vec4 outColor;
        uniform vec2 uRes;

        float hash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 uv = vUv;
          vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);

          // Sleek diagonal chromatic prism dispersion shafts (no face-obscuring circle rings!)
          float d1 = p.x * 0.84 + p.y * 0.54;
          float rCh = exp(-pow((d1 - 0.165) * 14.0, 2.0));
          float gCh = exp(-pow((d1 - 0.145) * 14.0, 2.0));
          float bCh = exp(-pow((d1 - 0.125) * 14.0, 2.0));

          float d2 = p.x * 0.84 + p.y * 0.54;
          float shaft2 = exp(-pow((d2 - 0.52) * 11.0, 2.0));
          float edgeSpecular = exp(-pow((d1 - 0.132) * 58.0, 2.0));

          vec3 col = vec3(0.0);
          col += vec3(rCh * 0.92, gCh * 0.62, bCh * 1.00) * 0.22;
          col += vec3(0.42, 0.88, 1.00) * shaft2 * 0.16;
          col += vec3(0.95, 0.98, 1.00) * edgeSpecular * 0.26;

          // Subtle ambient crystalline bokeh particles framing the edges
          for (int i = 0; i < 26; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 1.73 + 0.3, fi * 2.41 + 0.9);
            vec2 pos = vec2(hash(seed) * 1.75 - 0.875, hash(seed + 5.7) * 0.98 - 0.49);
            float rad = 0.005 + hash(seed + 2.9) * 0.018;
            float d = length(p - pos);
            float bokeh = smoothstep(rad, rad * 0.12, d) * (0.35 + 0.45 * hash(seed + 8.1));
            vec3 bCol = mix(vec3(0.55, 0.92, 1.0), vec3(0.96, 0.72, 1.0), hash(seed + 4.3));
            col += bCol * bokeh * 0.38;
          }

          float alpha = clamp(max(max(col.r, col.g), col.b) * 0.82, 0.0, 0.56);
          outColor = vec4(col, alpha);
        }
      \`;

      function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(s));
        }
        return s;
      }

      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), W, H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.finish();
      renderer = 'webgl2';
      return true;
    }

    function renderCanvas2DFallback() {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 24; i++) {
        const x = (i * 419.3) % W;
        const y = (i * 227.9) % H;
        const r = 8 + (i % 5) * 6;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, i % 2 === 0 ? 'rgba(125, 211, 252, 0.32)' : 'rgba(233, 213, 255, 0.30)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      renderer = 'canvas2d-fallback';
    }

    try {
      if (!renderWebGL2()) renderCanvas2DFallback();
    } catch {
      renderCanvas2DFallback();
    }
    window.__coverRenderMeta = { renderer, width: W, height: H };
  })();
  </script>
</body>
</html>`;
}

async function renderCovers(opts) {
  const heroPath = resolveHeroPath(opts.hero);
  if (!heroPath && !opts.allowPlaceholder && !opts.smoke) {
    throw new Error(
      `No sanitized hero frame found in assets/showcase/ (${HERO_CANDIDATES.join(', ')}). Pass --hero <path> or wait for @asset-sanitizer [assets-ready].`,
    );
  }

  const notoPath = findSystemFont('NotoSansSC-VF.ttf');
  const consolasPath = findSystemFont('consolab.ttf');
  const heroBuf = heroPath ? fs.readFileSync(heroPath) : null;
  const notoBuf = notoPath ? fs.readFileSync(notoPath) : null;
  const consolasBuf = consolasPath ? fs.readFileSync(consolasPath) : null;

  const browser = await launchBrowser({ width: 1920, height: 1200 });
  const results = [];

  try {
    const jobs = [
      {
        variant: '16x9',
        width: 1920,
        height: 1080,
        bgPos: opts.bgPos16x9,
        bgScale: COVER_TUNING.bgScale16x9,
        outFile: path.join(opts.outDir, 'cover-16x9.png'),
      },
      {
        variant: '4x3',
        width: 1600,
        height: 1200,
        bgPos: opts.bgPos4x3,
        bgScale: COVER_TUNING.bgScale4x3,
        outFile: path.join(opts.outDir, 'cover-4x3.png'),
      },
    ];

    for (const job of jobs) {
      const html = buildCoverHtml({
        variant: job.variant,
        hasNotoFont: Boolean(notoBuf),
        hasConsolasFont: Boolean(consolasBuf),
        bgPos: job.bgPos,
        bgScale: job.bgScale,
        hubBgPos: opts.hubBgPos,
        heroUrl: heroBuf ? '/assets/hero.png' : null,
      });

      const page = await browser.openPage({
        width: job.width,
        height: job.height,
        requestHandler: async (url) => {
          const u = new URL(url);
          if (u.pathname === '/cover') {
            return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
          }
          if (u.pathname === '/assets/hero.png' && heroBuf) {
            return { status: 200, headers: { 'Content-Type': 'image/png' }, body: heroBuf };
          }
          if (u.pathname === '/fonts/noto-sans-sc.ttf' && notoBuf) {
            return { status: 200, headers: { 'Content-Type': 'font/ttf' }, body: notoBuf };
          }
          if (u.pathname === '/fonts/consolab.ttf' && consolasBuf) {
            return { status: 200, headers: { 'Content-Type': 'font/ttf' }, body: consolasBuf };
          }
          return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' };
        },
      });

      await page.navigate('http://cover.local/cover');
      const meta = await page.evaluate(`(async () => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const imgs = [...document.querySelectorAll('img')];
        await Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const hl = document.querySelector('.hl-line-2')?.getBoundingClientRect();
        const hub = document.querySelector('.hub-frame')?.getBoundingClientRect();
        const badges = document.querySelector('.bottom-badges')?.getBoundingClientRect();
        const qp = document.querySelector('.quick-prism-card')?.getBoundingClientRect();
        return {
          ...(window.__coverRenderMeta || {}),
          loadedFonts: document.fonts ? [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family) : [],
          bounds: {
            hlRight: hl ? Math.round(hl.right) : 0,
            hubLeft: hub ? Math.round(hub.left) : 0,
            hubRight: hub ? Math.round(hub.right) : 0,
            hubBottom: hub ? Math.round(hub.bottom) : 0,
            badgesRight: badges ? Math.round(badges.right) : 0,
            badgesBottom: badges ? Math.round(badges.bottom) : 0,
            qpBox: qp ? [Math.round(qp.left), Math.round(qp.top), Math.round(qp.right), Math.round(qp.bottom)] : null,
          },
        };
      })()`);

      const shot = await page.capturePng(job.outFile, job.width, job.height);
      results.push({
        variant: job.variant,
        ...shot,
        renderer: meta.renderer,
        loadedFonts: [...new Set(meta.loadedFonts || [])],
        bounds: meta.bounds,
        consoleErrors: page.consoleErrors,
        pageExceptions: page.pageExceptions,
      });
      await browser.closePage(page);
    }
  } finally {
    await browser.close();
  }

  return {
    browser: browser.version.product,
    heroPath: heroPath || '(placeholder)',
    results,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.smoke) {
    opts.outDir = path.join(os.tmpdir(), `agy-cover-smoke-${Date.now()}`);
    opts.allowPlaceholder = true;
  }
  const summary = await renderCovers(opts);
  console.log(JSON.stringify(summary, null, 2));
  if (opts.smoke) {
    fs.rmSync(opts.outDir, { recursive: true, force: true });
  }
}
