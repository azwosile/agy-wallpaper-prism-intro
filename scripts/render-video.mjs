#!/usr/bin/env node
// Deterministic Frame-Accurate Headless Chromium (WebGL2) + FFmpeg Video Renderer
// Produces 1920x1080 H.264 High@4.2 yuv420p + 192kbps AAC Bilibili master video
// Supports:
//   --benchmark           Run 30-frame WebGL2 + capture speed benchmark
//   --preview-stills=DIR  Capture 14 key act frames into DIR for visual QA
//   --fps=60              Target output framerate (default 60)
//   --workers=3           Parallel headless Chrome shards (default 3)
//   --gl=auto|hw|swift    WebGL2 backend selection (default auto -> hw ANGLE)
//   --out=PATH            Output MP4 path (default out/agy-wallpaper-prism-intro.mp4)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ORIGIN = 'http://prism.local';

const CANDIDATE_BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

function findBrowserExecutable() {
  for (const p of CANDIDATE_BROWSERS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chrome/Edge executable found in standard Windows installation paths.');
}

function parseArgs(argv) {
  const opts = {
    fps: 60,
    workers: 3,
    gl: 'auto',
    quality: 94,
    benchmark: false,
    previewStills: null,
    out: path.join(ROOT_DIR, 'out', 'agy-wallpaper-prism-intro.mp4'),
    maxFrames: null,
  };
  for (const arg of argv) {
    if (arg === '--benchmark') opts.benchmark = true;
    else if (arg.startsWith('--preview-stills=')) opts.previewStills = path.resolve(arg.slice('--preview-stills='.length));
    else if (arg.startsWith('--fps=')) opts.fps = Math.max(15, Math.min(60, Number(arg.slice(6)) || 60));
    else if (arg.startsWith('--workers=')) opts.workers = Math.max(1, Math.min(6, Number(arg.slice(10)) || 3));
    else if (arg.startsWith('--gl=')) opts.gl = arg.slice(5);
    else if (arg.startsWith('--quality=')) opts.quality = Math.max(80, Math.min(100, Number(arg.slice(10)) || 94));
    else if (arg.startsWith('--out=')) opts.out = path.resolve(arg.slice(6));
    else if (arg.startsWith('--max-frames=')) opts.maxFrames = Math.max(1, Number(arg.slice(13)) || 1);
  }
  return opts;
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
        if (msg.id) {
          const entry = this.pending.get(msg.id);
          if (entry) {
            this.pending.delete(msg.id);
            if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message || JSON.stringify(msg.error)}`));
            else entry.resolve(msg.result);
          }
        } else if (msg.method) {
          for (const fn of [...this.eventListeners]) fn(msg);
        }
      }
    });
  }

  onEvent(fn) {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 30000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout on ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (res) => { clearTimeout(timer); resolve(res); },
        reject: (err) => { clearTimeout(timer); reject(err); },
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

// Create an isolated in-memory showcase server instance (one per worker shard so state never collides!)
async function createIsolatedShowcase() {
  const srvPath = path.join(ROOT_DIR, 'assets', 'showcase', 'showcase-server.mjs');
  if (!fs.existsSync(srvPath)) {
    throw new Error(`Missing showcase server: ${srvPath}`);
  }
  const mod = await import(`file:///${srvPath.replace(/\\/g, '/')}`);
  if (typeof mod.createShowcaseServer !== 'function') {
    throw new Error('assets/showcase/showcase-server.mjs does not export createShowcaseServer');
  }
  return mod.createShowcaseServer({ port: 0 });
}

function countHonkaiFrames() {
  const dir = path.join(ROOT_DIR, 'assets', 'showcase', 'honkai3-frames');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => /^\d+\.jpg$/i.test(f)).length;
}

// Create CDP Fetch router handling http://prism.local/* purely in-memory via srv.inject (0 TCP overhead!)
function createRouter(showcaseSrv, honkaiFrameCount) {
  const framesDir = path.join(ROOT_DIR, 'assets', 'showcase', 'honkai3-frames');
  const safeRead = (baseDir, relPath) => {
    const abs = path.resolve(baseDir, relPath.replace(/^\/+/, ''));
    if (!abs.startsWith(path.resolve(baseDir))) return null;
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return null;
    const ext = path.extname(abs).toLowerCase();
    return {
      status: 200,
      headers: {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.jpg' || ext === '.png' ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
      body: fs.readFileSync(abs),
    };
  };

  return async ({ url, method, headers, postData }) => {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname);

    if (p === '/' || p === '/scene' || p === '/scene/') {
      return safeRead(path.join(ROOT_DIR, 'scene'), 'index.html');
    }
    if (p.startsWith('/scene/')) {
      return safeRead(path.join(ROOT_DIR, 'scene'), p.slice('/scene/'.length))
        || { status: 404, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('Not found') };
    }
    if (p.startsWith('/audio/')) {
      return safeRead(path.join(ROOT_DIR, 'audio'), p.slice('/audio/'.length))
        || { status: 404, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('Not found') };
    }
    if (p.startsWith('/docs/')) {
      return safeRead(path.join(ROOT_DIR, 'docs'), p.slice('/docs/'.length))
        || { status: 404, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('Not found') };
    }
    // Short-circuit SSE stream cleanly so CDP Fetch.fulfillRequest never blocks waiting for stream end
    if (p === '/api/events') {
      return {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: Buffer.from(': deterministic-render\n\n', 'utf8'),
      };
    }
    if (p === '/media/honkai3-meta.json') {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: Buffer.from(JSON.stringify({ totalFrames: honkaiFrameCount, frameCount: honkaiFrameCount, startIndex: 0, fps: 60 })),
      };
    }
    if (p.startsWith('/media/honkai3-frames/')) {
      const hit = safeRead(framesDir, p.slice('/media/honkai3-frames/'.length));
      if (hit) return hit;
    }

    // Everything else (/hub, /studio, /host/*, /api/*, /media/*) dispatches directly in-memory via showcaseSrv.inject
    const resp = await showcaseSrv.inject({
      method: method || 'GET',
      url: u.pathname + u.search,
      headers: { ...(headers || {}), host: 'prism.local' },
      body: postData,
    });
    return {
      status: resp.statusCode || 200,
      headers: resp.headers || {},
      body: resp.body,
    };
  };
}

async function launchWorkerBrowser({ glMode = 'hw', router, bootConfig, workerIdx = 0 }) {
  const exe = findBrowserExecutable();
  const userDataDir = path.join(os.tmpdir(), `agy-prism-render-${process.pid}-${workerIdx}-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const glFlags = glMode === 'swift'
    ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader']
    : ['--enable-webgl', '--ignore-gpu-blocklist'];

  const proc = spawn(
    exe,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1920,1080',
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-pipe',
      ...glFlags,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] },
  );
  proc.stderr.on('data', () => {});

  const tr = new PipeTransport(proc.stdio[3], proc.stdio[4]);
  await tr.send('Browser.getVersion');
  const { targetId } = await tr.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await tr.send('Target.attachToTarget', { targetId, flatten: true });

  const errors = [];
  const off = tr.onEvent((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'Page exception');
    } else if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params;
      const postData = request.postData ? Buffer.from(request.postData, 'utf8') : null;
      Promise.resolve(router({
        url: request.url,
        method: request.method || 'GET',
        headers: request.headers || {},
        postData,
      }))
        .then((reply) => {
          const responseHeaders = [];
          for (const [k, v] of Object.entries(reply?.headers || {})) {
            if (v === undefined || v === null) continue;
            if (Array.isArray(v)) {
              for (const item of v) responseHeaders.push({ name: k, value: String(item) });
            } else {
              responseHeaders.push({ name: k, value: String(v) });
            }
          }
          const bodyBuf = Buffer.isBuffer(reply?.body) ? reply.body : Buffer.from(String(reply?.body || ''), 'utf8');
          return tr.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: reply?.status || 200,
            responseHeaders,
            body: bodyBuf.toString('base64'),
          }, sessionId);
        })
        .catch(() => {
          tr.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }, sessionId).catch(() => {});
        });
    }
  });

  await tr.send('Page.enable', {}, sessionId);
  await tr.send('Runtime.enable', {}, sessionId);
  await tr.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1920,
    screenHeight: 1080,
  }, sessionId);
  await tr.send('Fetch.enable', { patterns: [{ urlPattern: `${ORIGIN}/*` }] }, sessionId);
  await tr.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__BOOT_CONFIG = ${JSON.stringify(bootConfig)};`,
  }, sessionId);

  const loadDone = new Promise((resolve) => {
    const offLoad = tr.onEvent((m) => {
      if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') {
        offLoad();
        resolve();
      }
    });
    setTimeout(() => { offLoad(); resolve(); }, 15000);
  });
  await tr.send('Page.navigate', { url: `${ORIGIN}/scene/` }, sessionId);
  await loadDone;

  const bootEv = await tr.send('Runtime.evaluate', {
    expression: 'window.__bootPromise',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId, 30000);
  if (bootEv.exceptionDetails) {
    throw new Error(`Scene boot failed: ${bootEv.exceptionDetails.exception?.description || bootEv.exceptionDetails.text}`);
  }
  const bootInfo = bootEv.result?.value;

  async function setTime(tSec) {
    const ev = await tr.send('Runtime.evaluate', {
      expression: `window.__setTime(${tSec.toFixed(6)})`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId, 30000);
    if (ev.exceptionDetails) {
      throw new Error(`__setTime(${tSec}) error: ${ev.exceptionDetails.exception?.description || ev.exceptionDetails.text}`);
    }
  }

  async function captureJpeg(quality = 94) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await tr.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality,
          fromSurface: true,
          captureBeyondViewport: false,
        }, sessionId, 60000);
        return Buffer.from(res.data, 'base64');
      } catch (err) {
        if (attempt === 1) throw err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  async function capturePng() {
    const res = await tr.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }, sessionId, 30000);
    return Buffer.from(res.data, 'base64');
  }

  async function close() {
    off();
    try { await tr.send('Browser.close', {}, undefined, 2000); } catch {}
    tr.close();
    for (const s of proc.stdio || []) { try { s?.destroy?.(); } catch {} }
    try { proc.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 120));
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }

  return { bootInfo, setTime, captureJpeg, capturePng, close, errors };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString('utf8'); });
    p.on('close', (code) => {
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-1200)}`));
    });
  });
}

function runFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString('utf8'); });
    p.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(out));
      else reject(new Error(`ffprobe exited ${code}`));
    });
  });
}

async function renderShard({ workerIdx, startFrame, endFrame, fps, quality, glMode, honkaiFrameCount, bootConfig, segPath }) {
  const showcaseSrv = await createIsolatedShowcase();
  const router = createRouter(showcaseSrv, honkaiFrameCount);
  const worker = await launchWorkerBrowser({ glMode, router, bootConfig, workerIdx });
  const ff = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel', 'error',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-framerate', String(fps),
      '-i', '-',
      '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level', '4.2',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'tv',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-crf', '17',
      '-preset', 'medium',
      '-g', String(fps),
      '-r', String(fps),
      '-an',
      segPath,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d.toString('utf8'); });
  const ffExit = new Promise((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Shard ${workerIdx} ffmpeg exited ${code}: ${ffErr}`))));
  });

  const t0 = Date.now();
  const count = endFrame - startFrame;
  try {
    // Prime state cleanly at startFrame
    await worker.setTime(startFrame / fps);
    await new Promise((r) => setTimeout(r, 120));

    for (let f = startFrame; f < endFrame; f++) {
      await worker.setTime(f / fps);
      const buf = await worker.captureJpeg(quality);
      if (!ff.stdin.write(buf)) {
        await new Promise((r) => ff.stdin.once('drain', r));
      }
      const done = f - startFrame + 1;
      if (done % 180 === 0 || done === count) {
        const elapsed = (Date.now() - t0) / 1000;
        const msPerFrame = (elapsed * 1000) / done;
        console.log(`[shard ${workerIdx}] ${done}/${count} frames (${msPerFrame.toFixed(1)} ms/frame)`);
      }
    }
    ff.stdin.end();
    await ffExit;
  } finally {
    await worker.close();
    await showcaseSrv.close();
  }
  return {
    workerIdx,
    frames: count,
    elapsedSec: (Date.now() - t0) / 1000,
    webglMode: worker.bootInfo?.webglMode,
    webglRenderer: worker.bootInfo?.webglRenderer,
    errors: worker.errors,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const timelinePath = path.join(ROOT_DIR, 'audio', 'timeline.json');
  const timeline = fs.existsSync(timelinePath)
    ? JSON.parse(fs.readFileSync(timelinePath, 'utf8'))
    : { totalDurationSec: 85.0, fps: 60, lines: [] };

  const totalDurationSec = Number(timeline.totalDurationSec || 85.0);
  const totalFrames = opts.maxFrames || Math.round(totalDurationSec * opts.fps);
  const honkaiFrameCount = countHonkaiFrames();

  console.log(`[render-video] Config: honkaiFrames=${honkaiFrameCount}, duration=${totalDurationSec.toFixed(3)}s, fps=${opts.fps}, totalFrames=${totalFrames}, workers=${opts.workers}`);

  const bootConfig = {
    honkaiFramesUrl: '/media/honkai3-frames',
    honkaiStartIndex: 0,
    honkaiFrameCount: honkaiFrameCount || 721,
    honkaiFps: 60,
  };

  let glMode = opts.gl === 'swift' ? 'swift' : 'hw';

  // 1. Preview stills mode (fast visual inspection of all 6 acts / 15 shots)
  if (opts.previewStills) {
    fs.mkdirSync(opts.previewStills, { recursive: true });
    const showcaseSrv = await createIsolatedShowcase();
    const router = createRouter(showcaseSrv, honkaiFrameCount);
    const worker = await launchWorkerBrowser({ glMode, router, bootConfig, workerIdx: 0 });
    try {
      console.log('[preview-stills] Boot info:', JSON.stringify(worker.bootInfo));
      const lines = timeline.lines || [];
      const byAction = (act) => lines.find((l) => l.action === act);
      const mid = (act, frac, fallback) => {
        const l = byAction(act);
        return l ? l.startSec + (l.endSec - l.startSec) * frac : fallback;
      };
      const samples = [
        ['01_before', mid('cold_open_dark_ide_shatter', 0.55, 2.0)],
        ['02_shatter_reveal', mid('prism_refraction_burst_reveal_honkai3', 0.25, 5.2)],
        ['03_hero_3d', mid('hero_islands_3d_sweep', 0.65, 12.0)],
        ['04_open_studio', mid('open_sidecar_studio_pane', 0.68, 18.2)],
        ['05_steam_scan', mid('steam_library_autoscan_highlight', 0.55, 24.5)],
        ['06_click_honkai', mid('cursor_click_honkai3_card', 0.80, 32.1)],
        ['07_faststart', mid('fast_switch_speed_badge_and_preview', 0.50, 35.8)],
        ['08_accent_rail', mid('dynamic_chroma_accent_and_left_rail', 0.55, 41.8)],
        ['09_islands_macro', mid('toggle_islands_flush_macro_gap', 0.82, 49.0)],
        ['10_nord_light', mid('switch_scheme_dark_to_nord_light', 0.72, 55.4)],
        ['11_wcag_code', mid('macro_zoom_code_terminal_wcag', 0.65, 61.4)],
        ['12_ctrl_alt_w', mid('hotkey_ctrl_alt_w_quick_popover', 0.52, 67.6)],
        ['13_autoload', mid('click_normal_shortcut_autoload_success', 0.65, 75.6)],
        ['14_github_outro', mid('opensource_github_hero_card', 0.55, 81.8)],
        ['15_triple_cta', mid('bilibili_triple_cta_outro', 0.45, 87.7)],
      ];
      for (const [label, ts] of samples) {
        await worker.setTime(ts);
        await new Promise((r) => setTimeout(r, 90));
        await worker.setTime(ts);
        const png = await worker.capturePng();
        const outFile = path.join(opts.previewStills, `${label}.png`);
        fs.writeFileSync(outFile, png);
        console.log(`[preview-stills] Saved ${label}.png @ t=${ts.toFixed(2)}s (${(png.length / 1024).toFixed(0)} KB)`);
      }
      if (worker.errors.length) {
        console.warn('[preview-stills] Page exceptions:', worker.errors);
      }
    } finally {
      await worker.close();
      await showcaseSrv.close();
    }
    return;
  }

  // 2. Benchmark mode (30 frames)
  if (opts.benchmark) {
    const showcaseSrv = await createIsolatedShowcase();
    const router = createRouter(showcaseSrv, honkaiFrameCount);
    const worker = await launchWorkerBrowser({ glMode, router, bootConfig, workerIdx: 0 });
    try {
      console.log('[benchmark] Boot info:', JSON.stringify(worker.bootInfo));
      const t0 = Date.now();
      for (let i = 0; i < 30; i++) {
        await worker.setTime(4.5 + i / opts.fps);
        await worker.captureJpeg(opts.quality);
      }
      const elapsed = Date.now() - t0;
      const avgMs = elapsed / 30;
      const est1 = (avgMs * totalFrames) / 1000;
      const estW = est1 / opts.workers;
      console.log(JSON.stringify({
        glMode,
        webglMode: worker.bootInfo?.webglMode,
        webglRenderer: worker.bootInfo?.webglRenderer,
        avgFrameMs: Number(avgMs.toFixed(1)),
        estSingleWorkerSec: Number(est1.toFixed(1)),
        estParallelSec: Number(estW.toFixed(1)),
        workers: opts.workers,
        errors: worker.errors,
      }, null, 2));
    } finally {
      await worker.close();
      await showcaseSrv.close();
    }
    return;
  }

  // 3. Full Parallel Sharded Render -> Concat -> Mux Audio!
  const tmpDir = path.join(os.tmpdir(), `agy-prism-shards-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });

  const numWorkers = Math.min(opts.workers, Math.max(1, Math.floor(totalFrames / 60)));
  const framesPerShard = Math.ceil(totalFrames / numWorkers);
  const shardSpecs = [];
  for (let i = 0; i < numWorkers; i++) {
    const startFrame = i * framesPerShard;
    const endFrame = Math.min(totalFrames, (i + 1) * framesPerShard);
    if (startFrame >= endFrame) break;
    shardSpecs.push({
      workerIdx: i,
      startFrame,
      endFrame,
      fps: opts.fps,
      quality: opts.quality,
      glMode,
      honkaiFrameCount,
      bootConfig,
      segPath: path.join(tmpDir, `seg-${String(i).padStart(2, '0')}.mp4`),
    });
  }

  console.log(`[render-video] Launching ${shardSpecs.length} parallel Chromium WebGL2 workers (${totalFrames} frames @ ${opts.fps}fps)...`);
  const renderStart = Date.now();
  const shardResults = await Promise.all(shardSpecs.map((spec) => renderShard(spec)));
  const renderElapsed = (Date.now() - renderStart) / 1000;
  console.log(`[render-video] All shards complete in ${renderElapsed.toFixed(1)}s:`, JSON.stringify(shardResults));

  const concatTxt = path.join(tmpDir, 'concat.txt');
  fs.writeFileSync(
    concatTxt,
    shardSpecs.map((s) => `file '${s.segPath.replace(/\\/g, '/')}'`).join('\n') + '\n',
    'utf8',
  );

  const audioPath = path.join(ROOT_DIR, 'audio', 'master-mix.aac');
  const hasAudio = fs.existsSync(audioPath);

  console.log(`[render-video] Concatenating & muxing final MP4 -> ${opts.out}...`);
  const muxArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', concatTxt];
  if (hasAudio) muxArgs.push('-i', audioPath);
  muxArgs.push('-c:v', 'copy');
  if (hasAudio) muxArgs.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-shortest');
  muxArgs.push('-movflags', '+faststart', opts.out);

  await runFfmpeg(muxArgs);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const probe = await runFfprobe(opts.out);
  const vStream = probe.streams?.find((s) => s.codec_type === 'video');
  const aStream = probe.streams?.find((s) => s.codec_type === 'audio');
  const sizeMB = (fs.statSync(opts.out).size / (1024 * 1024)).toFixed(2);
  console.log('[render-video] Master MP4 verified:', JSON.stringify({
    path: opts.out,
    sizeMB: Number(sizeMB),
    durationSec: Number(probe.format?.duration || 0),
    video: vStream ? `${vStream.width}x${vStream.height} ${vStream.codec_name} ${vStream.pix_fmt} ${vStream.r_frame_rate}` : null,
    audio: aStream ? `${aStream.codec_name} ${aStream.sample_rate}Hz ${aStream.channels}ch ${Math.round(Number(aStream.bit_rate || 0) / 1000)}kbps` : null,
    totalRenderSec: Number(renderElapsed.toFixed(1)),
  }, null, 2));
}

main().catch((err) => {
  console.error('[render-video] FATAL:', err);
  process.exit(1);
});
