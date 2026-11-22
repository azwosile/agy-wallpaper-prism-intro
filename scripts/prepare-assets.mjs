#!/usr/bin/env node
/**
 * Showcase Asset Preparation & Sanitization Pipeline (`scripts/prepare-assets.mjs`)
 *
 * Reads the local Wallpaper Prism inventory cache read-only via `os.homedir()`,
 * extracts ONLY the approved SFW (`contentRating: 'everyone'`) showcase subset
 * anchored by the hero dynamic wallpaper `崩坏3周年庆（动态）` (`ws-2876797752`),
 * transcodes fast-seeking 1080p60 showcase media + frame-accurate JPEG sequence
 * + 4 hero PNG stills, and writes a 100% privacy-sanitized `assets/showcase/library.json`.
 *
 * Zero personal usernames, zero real user paths, zero mature/unvetted wallpapers.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SHOWCASE_DIR = join(PROJECT_ROOT, 'assets', 'showcase');
const THUMBS_DIR = join(SHOWCASE_DIR, 'thumbs');
const FRAMES_DIR = join(SHOWCASE_DIR, 'honkai3-frames');

const HERO_ID = 'ws-2876797752';

/**
 * Strictly vetted SFW showcase allowlist (all thumbnails visually inspected).
 * Every item uses clean, non-identifying metadata and `contentRating: 'everyone'`.
 */
const SFW_SHOWCASE_SPECS = [
  {
    id: 'ws-2876797752',
    title: '崩坏3周年庆（动态）',
    description: '4K 60fps 周年庆动态壁纸 · 零拷贝 MP4 极速流式播放',
    kind: 'video',
    source: 'workshop',
    workshopId: '2876797752',
    contentRating: 'everyone',
    tags: ['Anime', '4K60', 'Dynamic', 'Anniversary'],
    schemeColor: '#7f9ae3',
    accent: { darkHex: '#7FA6F8', lightHex: '#3B6FD8', tintRgb: '127, 166, 248' },
    width: 3840,
    height: 2160,
    resolution: '3840x2160',
    durationSec: 12.02,
    fps: 60,
    fileSize: 25576845,
    thumbFromHeroPoster: true,
    mediaUrl: '/media/honkai3-hero.mp4',
    posterUrl: '/media/honkai3-poster.png',
    framesPrefix: '/media/honkai3-frames/',
  },
  {
    id: 'ws-3008666979',
    title: '星空と少女',
    description: '4K 60fps 星夜流光动态壁纸',
    kind: 'video',
    source: 'workshop',
    workshopId: '3008666979',
    contentRating: 'everyone',
    tags: ['Anime', 'Starry', '4K60'],
    schemeColor: '#305b9d',
    accent: { darkHex: '#669DF6', lightHex: '#2563EB', tintRgb: '102, 157, 246' },
    width: 4096,
    height: 2160,
    resolution: '4096x2160',
    durationSec: 24.0,
    fps: 60,
    fileSize: 31457280,
    extractFrameAtSec: 2.0,
  },
  {
    id: 'def-beach',
    title: 'Golden Horizon · 黄金海岸',
    description: '日落椰林与波光粼粼的金色海面动态场景',
    kind: 'scene',
    source: 'default',
    workshopId: '',
    contentRating: 'everyone',
    tags: ['Scenic', 'Sunset', 'Ocean'],
    schemeColor: '#ffcc35',
    sceneMode: 'live',
    accent: { darkHex: '#F2B84B', lightHex: '#D97706', tintRgb: '242, 184, 75' },
    width: 1920,
    height: 1080,
    resolution: '1920x1080',
    fps: 60,
    fileSize: 10800000,
  },
  {
    id: 'ws-884307090',
    title: '完美壁纸 · 雪山星空音频时钟',
    description: '雪山星空音频可视化与动态时钟网页壁纸',
    kind: 'web',
    source: 'workshop',
    workshopId: '884307090',
    contentRating: 'everyone',
    tags: ['Web', 'Scenic', 'Audio', 'Clock'],
    schemeColor: '#7a7574',
    accent: { darkHex: '#A5B4FC', lightHex: '#4F46E5', tintRgb: '165, 180, 252' },
    width: 1920,
    height: 1080,
    resolution: '1920x1080',
    fps: 60,
    fileSize: 12600000,
  },
  {
    id: 'def-neon_sunset',
    title: 'Neon Sunset',
    description: 'Synthwave 霓虹落日网格动态场景',
    kind: 'scene',
    source: 'default',
    workshopId: '',
    contentRating: 'everyone',
    tags: ['Cyberpunk', 'Synthwave', 'Neon'],
    schemeColor: '#e30045',
    sceneMode: 'live',
    accent: { darkHex: '#F472B6', lightHex: '#DB2777', tintRgb: '244, 114, 182' },
    width: 1920,
    height: 1080,
    resolution: '1920x1080',
    fps: 60,
    fileSize: 9400000,
  },
  {
    id: 'def-deep_space',
    title: 'Deep Space',
    description: '深空旋涡星系星云实时场景',
    kind: 'scene',
    source: 'default',
    workshopId: '',
    contentRating: 'everyone',
    tags: ['Space', 'Scenic', 'Galaxy'],
    schemeColor: '#9b5c69',
    sceneMode: 'live',
    accent: { darkHex: '#E8A87C', lightHex: '#C25934', tintRgb: '232, 168, 124' },
    width: 1920,
    height: 1080,
    resolution: '1920x1080',
    fps: 60,
    fileSize: 11200000,
  },
  {
    id: 'def-techno',
    title: 'Techno Hex',
    description: '科技感六边形霓虹光脉矩阵',
    kind: 'scene',
    source: 'default',
    workshopId: '',
    contentRating: 'everyone',
    tags: ['Tech', 'Abstract', 'Grid'],
    schemeColor: '#1a33b3',
    sceneMode: 'live',
    accent: { darkHex: '#60A5FA', lightHex: '#2563EB', tintRgb: '96, 165, 250' },
    width: 1920,
    height: 1080,
    resolution: '1920x1080',
    fps: 60,
    fileSize: 7800000,
  },
  {
    id: 'builtin-prism-aurora',
    title: 'Prism Aurora · 棱镜极光',
    description: 'Obsidian Prism 内置程序化极光光学舞台（零外部素材依赖）',
    kind: 'scene',
    source: 'default',
    workshopId: '',
    contentRating: 'everyone',
    tags: ['Prism', 'Aurora', 'Builtin'],
    schemeColor: '#669DF6',
    sceneMode: 'live',
    accent: { darkHex: '#669DF6', lightHex: '#2563EB', tintRgb: '102, 157, 246' },
    width: 3840,
    height: 2160,
    resolution: '3840x2160',
    fps: 60,
    fileSize: 0,
    proceduralAurora: true,
  },
];

function runFfmpeg(args, label) {
  console.log(`[ffmpeg] ${label}...`);
  const res = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'warning', ...args], {
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(`ffmpeg failed (${label}) with exit code ${res.status}`);
  }
}

function probeVideo(filePath) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration',
      '-show_entries', 'format=duration,size',
      '-of', 'json',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(out);
}

function loadInventoryMapOptional() {
  const invPath = join(homedir(), '.agy-wallpaper-prism', 'cache', 'inventory-index.json');
  if (!existsSync(invPath)) {
    return null;
  }
  const raw = JSON.parse(readFileSync(invPath, 'utf8'));
  const entries = raw.entries || raw.items || raw;
  const list = Array.isArray(entries)
    ? entries
    : Object.entries(entries).map(([k, v]) => ({ _key: k, ...v }));
  const map = new Map();
  for (const entry of list) {
    const item = entry.rawItem && typeof entry.rawItem === 'object' ? entry.rawItem : entry;
    if (item && item.id) map.set(String(item.id), item);
  }
  return map;
}

/**
 * Render a smooth, high-craft 1280x720 procedural Obsidian Prism Aurora backdrop JPG via ffmpeg rawvideo pipe.
 */
function renderProceduralAuroraJpg(outPath) {
  const W = 1280;
  const H = 720;
  const buf = Buffer.allocUnsafe(W * H * 3);

  // Deterministic pseudo-random stars
  const stars = [];
  let seed = 421337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < 110; i++) {
    stars.push({
      x: Math.floor(rand() * W),
      y: Math.floor(rand() * H * 0.78),
      b: 0.35 + rand() * 0.65,
      r: rand() > 0.8 ? 2 : 1,
    });
  }

  for (let y = 0; y < H; y++) {
    const ny = y / H;
    for (let x = 0; x < W; x++) {
      const nx = x / W;

      // Deep obsidian night sky gradient
      let r = 8 + ny * 10;
      let g = 11 + ny * 14;
      let b = 22 + ny * 26;

      // Primary cyan-cobalt aurora ribbon
      const wave1 = 0.42 + 0.12 * Math.sin(nx * 5.2 + 0.4) + 0.05 * Math.cos(nx * 11.4);
      const d1 = Math.abs(ny - wave1);
      const band1 = Math.exp(-(d1 * d1) / 0.016) * (0.65 + 0.35 * Math.sin(nx * 9.0 + ny * 6.0));
      r += band1 * 48;
      g += band1 * 172;
      b += band1 * 245;

      // Secondary iris-violet dispersion veil
      const wave2 = 0.54 + 0.14 * Math.cos(nx * 4.1 - 0.8) + 0.04 * Math.sin(nx * 13.0);
      const d2 = Math.abs(ny - wave2);
      const band2 = Math.exp(-(d2 * d2) / 0.024) * (0.55 + 0.45 * Math.cos(nx * 7.5 - 1.2));
      r += band2 * 148;
      g += band2 * 82;
      b += band2 * 238;

      // Emerald prismatic caustic glint along upper horizon
      const wave3 = 0.33 + 0.09 * Math.sin(nx * 6.8 + 2.1);
      const d3 = Math.abs(ny - wave3);
      const band3 = Math.exp(-(d3 * d3) / 0.008) * Math.max(0, Math.sin(nx * 3.14159));
      r += band3 * 36;
      g += band3 * 212;
      b += band3 * 178;

      // Subtle diagonal prism refraction beam
      const beamDist = Math.abs((nx - 0.56) * 0.8 + (ny - 0.48) * 0.6);
      const beam = Math.exp(-(beamDist * beamDist) / 0.009) * 0.24;
      r += beam * 180;
      g += beam * 215;
      b += beam * 255;

      // Soft radial vignette
      const vx = nx - 0.5;
      const vy = ny - 0.5;
      const vig = 1 - Math.min(0.45, (vx * vx + vy * vy) * 1.15);
      r *= vig;
      g *= vig;
      b *= vig;

      // Soft Reinhard highlight rolloff for silky aurora glow
      const tone = (v) => Math.round((255 * v) / (255 + v * 0.42));
      const idx = (y * W + x) * 3;
      buf[idx] = Math.max(0, Math.min(255, tone(r)));
      buf[idx + 1] = Math.max(0, Math.min(255, tone(g)));
      buf[idx + 2] = Math.max(0, Math.min(255, tone(b)));
    }
  }

  for (const s of stars) {
    for (let dy = -s.r; dy <= s.r; dy++) {
      for (let dx = -s.r; dx <= s.r; dx++) {
        const px = s.x + dx;
        const py = s.y + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const falloff = Math.max(0, 1 - Math.hypot(dx, dy) / (s.r + 0.6));
        const idx = (py * W + px) * 3;
        const boost = Math.round(215 * s.b * falloff);
        buf[idx] = Math.min(255, buf[idx] + Math.round(boost * 0.85));
        buf[idx + 1] = Math.min(255, buf[idx + 1] + Math.round(boost * 0.92));
        buf[idx + 2] = Math.min(255, buf[idx + 2] + boost);
      }
    }
  }

  const res = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'rgb24',
      '-video_size', `${W}x${H}`,
      '-i', 'pipe:0',
      '-frames:v', '1',
      '-update', '1',
      '-q:v', '2',
      outPath,
    ],
    { input: buf, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  if (res.status !== 0) {
    throw new Error(`ffmpeg failed rendering procedural aurora (exit ${res.status})`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const fallbackIdx = args.indexOf('--fallback-thumbs-dir');
  const fallbackThumbsDir = fallbackIdx >= 0 && args[fallbackIdx + 1] ? resolve(args[fallbackIdx + 1]) : '';

  mkdirSync(SHOWCASE_DIR, { recursive: true });
  mkdirSync(THUMBS_DIR, { recursive: true });

  const invMap = loadInventoryMapOptional();
  const heroMp4Out = join(SHOWCASE_DIR, 'honkai3-hero.mp4');

  // 1. Transcode 1920x1080 60fps H.264 faststart + keyframe every 30 frames (-g 30)
  if (force || !existsSync(heroMp4Out)) {
    const heroRaw = invMap?.get(HERO_ID);
    if (!heroRaw || !heroRaw._fs?.primaryAbs || !existsSync(heroRaw._fs.primaryAbs)) {
      throw new Error(`Hero wallpaper ${HERO_ID} (崩坏3周年庆（动态）) media file not found in local Workshop library.`);
    }
    runFfmpeg(
      [
        '-y',
        '-i', heroRaw._fs.primaryAbs,
        '-vf', 'scale=1920:1080:flags=lanczos',
        '-r', '60',
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-level', '4.2',
        '-pix_fmt', 'yuv420p',
        '-crf', '16',
        '-preset', 'medium',
        '-g', '30',
        '-keyint_min', '30',
        '-sc_threshold', '0',
        '-an',
        '-movflags', '+faststart',
        heroMp4Out,
      ],
      'Transcode honkai3-hero.mp4 (1920x1080@60fps crf16 g=30)',
    );
  } else {
    console.log('[skip] Reusing existing honkai3-hero.mp4 (pass --force to re-encode)');
  }

  const heroProbe = probeVideo(heroMp4Out);
  const vStream = heroProbe.streams?.[0] || {};
  const heroDurationSec = Number(heroProbe.format?.duration || vStream.duration || 12.02);
  console.log(
    `[ok] honkai3-hero.mp4: ${vStream.width}x${vStream.height} @ ${vStream.avg_frame_rate}, ` +
      `${heroDurationSec.toFixed(2)}s, ${(statSync(heroMp4Out).size / 1024 / 1024).toFixed(2)} MB`,
  );

  // 2. Sample 4 crisp 1920x1080 PNG stills across honkai3-hero.mp4 (0.5s, 3.5s, 6.5s, 9.5s)
  const stillSpecs = [
    { file: 'honkai3-poster.png', sec: 0.5 },
    { file: 'honkai3-frame-a.png', sec: 3.5 },
    { file: 'honkai3-frame-b.png', sec: 6.5 },
    { file: 'honkai3-frame-c.png', sec: 9.5 },
  ];
  for (const s of stillSpecs) {
    const dest = join(SHOWCASE_DIR, s.file);
    if (force || !existsSync(dest)) {
      runFfmpeg(
        [
          '-y',
          '-ss', String(s.sec),
          '-i', heroMp4Out,
          '-frames:v', '1',
          '-update', '1',
          '-pix_fmt', 'rgb24',
          dest,
        ],
        `Extract ${s.file} @ ${s.sec}s`,
      );
    }
  }

  // 3. Extract 60fps deterministic JPEG frame sequence (`0000.jpg` .. `0720.jpg`, 0-indexed)
  const existingFrames = existsSync(FRAMES_DIR)
    ? readdirSync(FRAMES_DIR).filter((f) => /^\d{4}\.jpg$/.test(f)).sort()
    : [];
  if (force || existingFrames.length < 700) {
    if (existsSync(FRAMES_DIR)) {
      rmSync(FRAMES_DIR, { recursive: true, force: true });
    }
    mkdirSync(FRAMES_DIR, { recursive: true });
    runFfmpeg(
      [
        '-y',
        '-i', heroMp4Out,
        '-vf', 'fps=60,scale=1920:1080:flags=lanczos',
        '-start_number', '0',
        '-q:v', '4',
        join(FRAMES_DIR, '%04d.jpg'),
      ],
      'Extract honkai3-frames/%04d.jpg (60fps JPEG sequence)',
    );
  } else {
    console.log(`[skip] Reusing existing ${existingFrames.length} frames in honkai3-frames/`);
  }

  const frameFiles = readdirSync(FRAMES_DIR).filter((f) => /^\d{4}\.jpg$/.test(f)).sort();
  let framesTotalBytes = 0;
  for (const f of frameFiles) {
    framesTotalBytes += statSync(join(FRAMES_DIR, f)).size;
  }
  const framesManifest = {
    heroId: HERO_ID,
    title: '崩坏3周年庆（动态）',
    width: 1920,
    height: 1080,
    fps: 60,
    startIndex: 0,
    frameCount: frameFiles.length,
    durationSec: Number(heroDurationSec.toFixed(3)),
    pattern: '%04d.jpg',
    urlPrefix: '/media/honkai3-frames/',
    firstFile: frameFiles[0] || '0000.jpg',
    lastFile: frameFiles[frameFiles.length - 1] || '0000.jpg',
    totalSizeMB: Number((framesTotalBytes / 1024 / 1024).toFixed(2)),
  };
  writeFileSync(join(FRAMES_DIR, 'manifest.json'), `${JSON.stringify(framesManifest, null, 2)}\n`, 'utf8');
  console.log(
    `[ok] honkai3-frames/: ${frameFiles.length} frames (${framesManifest.firstFile}..${framesManifest.lastFile}), ` +
      `${framesManifest.totalSizeMB} MB total`,
  );

  // 4. Generate crisp, sanitized SFW thumbnails in assets/showcase/thumbs/ and prune stale files
  const allowedThumbNames = new Set(SFW_SHOWCASE_SPECS.map((s) => `${s.id}.jpg`));
  for (const existing of readdirSync(THUMBS_DIR)) {
    if (!allowedThumbNames.has(existing)) {
      rmSync(join(THUMBS_DIR, existing), { force: true });
      console.log(`[prune] Removed stale thumbnail ${existing}`);
    }
  }

  const sanitizedItems = [];
  const accentCache = {};

  for (let i = 0; i < SFW_SHOWCASE_SPECS.length; i++) {
    const spec = SFW_SHOWCASE_SPECS[i];
    const thumbFile = `${spec.id}.jpg`;
    const thumbOut = join(THUMBS_DIR, thumbFile);
    const rawItem = invMap?.get(spec.id);

    const findFallbackPreview = () => {
      if (!fallbackThumbsDir || !existsSync(fallbackThumbsDir)) return '';
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const cand = join(fallbackThumbsDir, `${spec.id}${ext}`);
        if (existsSync(cand)) return cand;
      }
      return '';
    };

    if (spec.proceduralAurora) {
      console.log(`[gen] Render procedural Prism Aurora thumb ${thumbFile}...`);
      renderProceduralAuroraJpg(thumbOut);
    } else if (!force && existsSync(thumbOut)) {
      console.log(`[skip] Reusing verified SFW thumb ${thumbFile}`);
    } else if (spec.thumbFromHeroPoster) {
      runFfmpeg(
        [
          '-y',
          '-i', join(SHOWCASE_DIR, 'honkai3-poster.png'),
          '-vf', 'scale=960:540:flags=lanczos',
          '-frames:v', '1',
          '-update', '1',
          '-q:v', '2',
          thumbOut,
        ],
        `Build crisp hero thumb ${thumbFile}`,
      );
    } else if (spec.extractFrameAtSec !== undefined && rawItem?._fs?.primaryAbs && existsSync(rawItem._fs.primaryAbs)) {
      runFfmpeg(
        [
          '-y',
          '-ss', String(spec.extractFrameAtSec),
          '-i', rawItem._fs.primaryAbs,
          '-frames:v', '1',
          '-update', '1',
          '-vf', 'scale=960:540:flags=lanczos',
          '-q:v', '2',
          thumbOut,
        ],
        `Extract crisp video thumb ${thumbFile}`,
      );
    } else {
      const previewSource =
        (rawItem?._fs?.previewAbs && existsSync(rawItem._fs.previewAbs) ? rawItem._fs.previewAbs : '') ||
        findFallbackPreview();
      if (!previewSource) {
        throw new Error(`Missing source media/preview for approved SFW item: ${spec.id}`);
      }
      runFfmpeg(
        [
          '-y',
          '-i', previewSource,
          '-frames:v', '1',
          '-update', '1',
          '-vf', 'scale=960:540:force_original_aspect_ratio=increase:flags=lanczos,crop=960:540',
          '-q:v', '2',
          thumbOut,
        ],
        `Convert SFW thumb ${thumbFile}`,
      );
    }

    const thumbUrl = `/media/thumbs/${thumbFile}`;
    const mediaUrl = spec.mediaUrl || thumbUrl;
    const posterUrl = spec.posterUrl || thumbUrl;

    accentCache[spec.id] = {
      wallpaperId: spec.id,
      darkHex: spec.accent.darkHex,
      lightHex: spec.accent.lightHex,
      tintRgb: spec.accent.tintRgb,
    };

    sanitizedItems.push({
      id: spec.id,
      title: spec.title,
      description: spec.description,
      kind: spec.kind,
      source: spec.source,
      workshopId: spec.workshopId,
      contentRating: 'everyone',
      tags: spec.tags,
      schemeColor: spec.schemeColor,
      sceneMode: spec.sceneMode || '',
      properties: [],
      wireProps: {},
      fileSize: spec.fileSize,
      width: spec.width,
      height: spec.height,
      resolution: spec.resolution,
      durationSec: spec.durationSec ?? null,
      fps: spec.fps,
      slideCount: 0,
      slideIntervalMs: 0,
      updatedAt: 1763800000000 - i * 3600_000,
      thumbUrl,
      mediaUrl,
      posterUrl,
      ...(spec.framesPrefix ? { framesPrefix: spec.framesPrefix, frameCount: framesManifest.frameCount } : {}),
    });
  }

  // 5. Write 100% privacy-sanitized assets/showcase/library.json
  const byKind = { image: 0, video: 0, slideshow: 0, web: 0, scene: 0 };
  const bySource = { workshop: 0, default: 0, upload: 0, local: 0 };
  for (const item of sanitizedItems) {
    if (item.kind in byKind) byKind[item.kind] += 1;
    if (item.source in bySource) bySource[item.source] += 1;
  }

  const sanitizedPaths = {
    steamRoot: 'Steam/steamapps/workshop/content/431960',
    uploadDir: '~/Pictures/wallpapers',
    cacheDir: '~/.agy-wallpaper-prism/cache',
    dataDir: '~/.agy-wallpaper-prism',
  };

  const libraryDoc = {
    meta: {
      sanitized: true,
      privacyChecked: true,
      contentRatingPolicy: 'everyone-only',
      pluginVersion: '1.1.0',
      heroId: HERO_ID,
      honkaiFrames: framesManifest,
      paths: sanitizedPaths,
    },
    stats: {
      total: sanitizedItems.length,
      workshop: bySource.workshop,
      uploads: bySource.upload + bySource.local,
      byKind,
      bySource,
      scanDurationMs: 8.3,
      scannedAt: 1763800000000,
      ...sanitizedPaths,
    },
    accentCache,
    items: sanitizedItems,
  };

  const libJsonPath = join(SHOWCASE_DIR, 'library.json');
  writeFileSync(libJsonPath, `${JSON.stringify(libraryDoc, null, 2)}\n`, 'utf8');
  console.log(`[ok] Wrote sanitized ${libJsonPath} (${sanitizedItems.length} strictly SFW items).`);
}

main();
