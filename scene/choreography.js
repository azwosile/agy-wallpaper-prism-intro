import { PrismWebGL } from '/scene/webgl-prism.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOutCubic = (t) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const easeOutBack = (t) => {
  const x = clamp(t, 0, 1);
  const c1 = 1.45;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const bezier2 = (p0, p1, p2, t) => {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
};

// Frame-exact prefetching player for honkai3-frames/%04d.jpg (0-indexed 0000..0720)
class HonkaiFramePlayer {
  constructor({ baseUrl = '/media/honkai3-frames', startIndex = 0, totalFrames = 721, fps = 60, fallbackPoster = '/media/honkai3-poster.png' } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.startIndex = Number(startIndex || 0);
    this.totalFrames = Math.max(1, totalFrames);
    this.fps = fps;
    this.fallbackPoster = fallbackPoster;
    this.cache = new Map();
    this.inflight = new Map();
    this.maxCache = 16;
    this.posterImg = null;
  }

  frameUrl(offset) {
    const wrapped = ((offset % this.totalFrames) + this.totalFrames) % this.totalFrames;
    const fileNum = this.startIndex + wrapped;
    return `${this.baseUrl}/${String(fileNum).padStart(4, '0')}.jpg`;
  }

  _loadImg(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'sync';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async ensurePoster() {
    if (!this.posterImg) {
      this.posterImg = await this._loadImg(this.fallbackPoster);
    }
    return this.posterImg;
  }

  prefetch(offset, count = 8) {
    for (let k = 1; k <= count; k++) {
      const n = ((offset + k) % this.totalFrames + this.totalFrames) % this.totalFrames;
      if (!this.cache.has(n) && !this.inflight.has(n)) {
        const p = this._loadImg(this.frameUrl(n)).then((img) => {
          this.inflight.delete(n);
          if (img) this._put(n, img);
          return img;
        });
        this.inflight.set(n, p);
      }
    }
  }

  _put(n, img) {
    if (this.cache.has(n)) this.cache.delete(n);
    this.cache.set(n, img);
    while (this.cache.size > this.maxCache) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  async getFrameForTime(tSec) {
    const offset = Math.floor(Math.max(0, tSec) * this.fps) % this.totalFrames;
    this.prefetch(offset, 6);
    if (this.cache.has(offset)) {
      return this.cache.get(offset);
    }
    if (this.inflight.has(offset)) {
      const img = await this.inflight.get(offset);
      if (img) return img;
    }
    const p = this._loadImg(this.frameUrl(offset)).then((img) => {
      this.inflight.delete(offset);
      if (img) this._put(offset, img);
      return img;
    });
    this.inflight.set(offset, p);
    const img = await p;
    if (img) return img;
    return this.ensurePoster();
  }
}

// Draw cover-fitted image onto canvas
function drawCover(ctx, img, cw, ch) {
  if (!ctx || !img || !img.naturalWidth) return;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.max(cw / iw, ch / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (cw - dw) * 0.5;
  const dy = (ch - dh) * 0.5;
  ctx.drawImage(img, dx, dy, dw, dh);
}

const el = (id) => document.getElementById(id);

const DOM = {
  webglCanvas: el('webgl-bg'),
  ambientCanvas: el('honkai-ambient'),
  ambientScrim: el('ambient-scrim'),
  cameraRig: el('camera-rig'),
  hubWindow: el('hub-window'),
  studioWindow: el('studio-window'),
  hubFrame: el('hub-frame'),
  studioFrame: el('studio-frame'),
  hubBadgeText: el('hub-badge-text'),
  beforeVeil: el('before-dark-veil'),
  beforeFracture: el('before-fracture-line'),
  macroCalliper: el('macro-calliper'),
  calliperBar: el('calliper-bar'),
  calliperPill: el('calliper-pill'),
  wcagBadge: el('wcag-lens-badge'),
  wcagGrade: el('wcag-grade'),
  wcagTitle: el('wcag-title'),
  wcagSub: el('wcag-sub'),
  shatterLayer: el('shatter-layer'),
  stepPill: el('step-pill'),
  stepText: el('step-text'),
  metricPrimary: el('metric-primary'),
  metricVal: el('metric-val'),
  metricTitle: el('metric-title'),
  metricSub: el('metric-sub'),
  metricSecondary: el('metric-secondary'),
  metric2Title: el('metric2-title'),
  metric2Sub: el('metric2-sub'),
  heroBanner: el('hero-reveal-banner'),
  heroBadgesRail: el('hero-badges-rail'),
  hb1: el('hb-1'),
  hb2: el('hb-2'),
  hb3: el('hb-3'),
  schemeRibbon: el('scheme-ribbon'),
  schemeRibbonLabel: el('scheme-ribbon-label'),
  keycapStage: el('keycap-stage'),
  keyCtrl: el('key-ctrl'),
  keyAlt: el('key-alt'),
  keyW: el('key-w'),
  shortcutToast: el('shortcut-success-toast'),
  outroPanel: el('outro-panel'),
  tripleCtaDock: el('triple-cta-dock'),
  ctaLike: el('cta-like'),
  ctaCoin: el('cta-coin'),
  ctaFav: el('cta-fav'),
  cursor: el('virtual-cursor'),
  ripple1: el('ripple-1'),
  ripple2: el('ripple-2'),
  ripple3: el('ripple-3'),
  subtitleBox: el('subtitle-box'),
  subtitleText: el('subtitle-text'),
  subtitleEq: el('subtitle-eq'),
  subtitleProgress: el('subtitle-progress'),
  chromaticWipe: el('chromatic-wipe'),
  bottomSpectrum: el('bottom-spectrum'),
  outroFade: el('outro-fade'),
};

// Build 14 deterministic crystal shatter shards for Act 1 reveal
const SHARDS = [];
function buildShatterShards() {
  DOM.shatterLayer.innerHTML = '';
  SHARDS.length = 0;
  for (let i = 0; i < 14; i++) {
    const div = document.createElement('div');
    div.className = 'crystal-shard';
    const angle = (i / 14) * Math.PI * 2 + (i % 2 === 0 ? 0.14 : -0.18);
    const w = 90 + ((i * 53) % 140);
    const h = 70 + ((i * 37) % 120);
    const speed = 520 + ((i * 197) % 720);
    const spin = (i % 2 === 0 ? 1 : -1) * (85 + ((i * 43) % 160));
    const p1 = `${10 + ((i * 17) % 35)}% 0%`;
    const p2 = `100% ${18 + ((i * 29) % 45)}%`;
    const p3 = `${55 + ((i * 19) % 40)}% 100%`;
    const p4 = `0% ${45 + ((i * 23) % 45)}%`;
    div.style.width = `${w}px`;
    div.style.height = `${h}px`;
    div.style.marginLeft = `${-w / 2}px`;
    div.style.marginTop = `${-h / 2}px`;
    div.style.clipPath = `polygon(${p1}, ${p2}, ${p3}, ${p4})`;
    DOM.shatterLayer.appendChild(div);
    SHARDS.push({ el: div, angle, speed, spin });
  }
}

const STATE = {
  ready: false,
  webgl: null,
  ambientCtx: null,
  honkai: null,
  timeline: null,
  energy: null,
  shots: [],
  shotMap: new Map(),
  totalDurationSec: 85.0,
  library: [],
  heroItem: null,
  altItem: null,
  applied: {
    skinEnabled: null,
    activeId: null,
    studioTab: null,
    layoutMode: null,
    colorScheme: null,
    themeMode: null,
    backdropBlur: null,
    codeReadabilityMode: null,
    popoverOpen: null,
    popoverOpacity: null,
    normalShortcutEnabled: null,
    cardHoverId: null,
  },
};

function normalizeTimeline(tlJson, fallbackScript) {
  const rawLines = (tlJson && Array.isArray(tlJson.lines) && tlJson.lines.length)
    ? tlJson.lines
    : (fallbackScript?.lines || []);
  const shots = [];
  for (let i = 0; i < rawLines.length; i++) {
    const ln = rawLines[i];
    const startSec = Number(ln.startSec ?? ln.targetStartSec ?? i * 5.2);
    const nextStart = i + 1 < rawLines.length
      ? Number(rawLines[i + 1].startSec ?? rawLines[i + 1].targetStartSec ?? startSec + 5.2)
      : Number(tlJson?.totalDurationSec ?? fallbackScript?.meta?.targetDurationSec ?? startSec + 6.5);
    const durationSec = Number(ln.durationSec ?? Math.max(1.5, nextStart - startSec - Number(ln.pauseAfterSec ?? 0.35)));
    const endSec = Number(ln.endSec ?? (startSec + durationSec));
    shots.push({
      index: i,
      id: ln.id || `line_${i + 1}`,
      act: Number(ln.act || 1),
      scene: ln.scene || '',
      action: ln.action || '',
      startSec,
      endSec,
      durationSec: Math.max(0.5, endSec - startSec),
      slotEndSec: nextStart,
      text: ln.text || '',
      subtitle: ln.subtitle || ln.text || '',
      callout: ln.callout || '',
    });
  }
  const totalDurationSec = Number(
    tlJson?.totalDurationSec
    ?? (shots.length ? Math.max(shots[shots.length - 1].endSec + 2.5, shots[shots.length - 1].slotEndSec) : 85),
  );
  if (shots.length) {
    shots[shots.length - 1].slotEndSec = totalDurationSec;
  }
  return { shots, totalDurationSec };
}

function sampleEnergy(tSec) {
  const e = STATE.energy;
  if (!e || !Array.isArray(e.rms) || !e.rms.length) {
    const pulse = 0.5 + 0.5 * Math.sin(tSec * (132 / 60) * Math.PI * 2);
    return { rms: 0.35 + pulse * 0.2, bass: 0.3 + pulse * 0.35, treble: 0.25 + pulse * 0.25, beat: Math.pow(pulse, 4) };
  }
  const fps = e.fps || 60;
  const idx = clamp(Math.floor(tSec * fps), 0, e.rms.length - 1);
  const rms = Number(e.rms[idx] || 0);
  const bass = Number(e.bass?.[idx] ?? rms);
  const treble = Number(e.treble?.[idx] ?? rms);

  // Beat proximity decay from e.beats
  let beat = 0;
  if (Array.isArray(e.beats) && e.beats.length) {
    for (let i = 0; i < e.beats.length; i++) {
      const dt = tSec - e.beats[i];
      if (dt >= -0.02 && dt <= 0.32) {
        const b = Math.exp(-Math.max(0, dt) * 11.0);
        if (b > beat) beat = b;
      }
    }
  }
  return { rms, bass, treble, beat };
}

function getHubWin() {
  try { return DOM.hubFrame?.contentWindow || null; } catch { return null; }
}
function getHubDoc() {
  try { return DOM.hubFrame?.contentDocument || null; } catch { return null; }
}
function getStudioWin() {
  try { return DOM.studioFrame?.contentWindow || null; } catch { return null; }
}
function getStudioDoc() {
  try { return DOM.studioFrame?.contentDocument || null; } catch { return null; }
}

// Inject crisp canvas into /hub #agy-prism-stage and /studio .prism-preview-stage for frame-accurate Honkai3 playback
function syncHonkaiCanvases(img, isHonkaiActive) {
  // 1. Hub stage canvas
  const hubDoc = getHubDoc();
  if (hubDoc) {
    const stage = hubDoc.getElementById('agy-prism-stage');
    if (stage) {
      let wrap = stage.querySelector('.agy-prism-media-wrap');
      if (!wrap) {
        wrap = hubDoc.createElement('div');
        wrap.className = 'agy-prism-media-wrap';
        stage.insertBefore(wrap, stage.firstChild);
      }
      let cv = wrap.querySelector('canvas[data-honkai-sync="1"]');
      if (isHonkaiActive && img) {
        if (!cv) {
          cv = hubDoc.createElement('canvas');
          cv.setAttribute('data-honkai-sync', '1');
          cv.className = 'agy-prism-media-el';
          cv.width = 1640;
          cv.height = 820;
          cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:2;';
          wrap.appendChild(cv);
        }
        cv.style.display = 'block';
        // Hide underlying video/img briefly so zero decode flicker shows through
        for (const v of wrap.querySelectorAll('video')) {
          v.pause?.();
          v.style.opacity = '0';
        }
        const ctx = cv.getContext('2d');
        drawCover(ctx, img, cv.width, cv.height);
      } else if (cv) {
        cv.style.display = 'none';
        for (const v of wrap.querySelectorAll('video')) v.style.opacity = '1';
      }
    }
  }

  // 2. Studio 21:9 preview canvas
  const studioDoc = getStudioDoc();
  if (studioDoc) {
    const preview = studioDoc.querySelector('.prism-preview-stage');
    if (preview) {
      let cv = preview.querySelector('canvas[data-honkai-preview="1"]');
      if (isHonkaiActive && img) {
        if (!cv) {
          cv = studioDoc.createElement('canvas');
          cv.setAttribute('data-honkai-preview', '1');
          cv.width = 640;
          cv.height = 280;
          cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1;pointer-events:none;border-radius:inherit;';
          preview.insertBefore(cv, preview.firstChild);
        }
        cv.style.display = 'block';
        for (const v of preview.querySelectorAll('video')) {
          v.pause?.();
          v.style.opacity = '0';
        }
        const ctx = cv.getContext('2d');
        drawCover(ctx, img, cv.width, cv.height);
      } else if (cv) {
        cv.style.display = 'none';
        for (const v of preview.querySelectorAll('video')) v.style.opacity = '1';
      }
    }
  }
}

// Declaratively reconcile real /hub and /studio DOM state (idempotent & awaited for parallel worker sharding!)
async function reconcileRealUI(desired) {
  const hubWin = getHubWin();
  const hubDoc = getHubDoc();
  const studioDoc = getStudioDoc();
  const ap = STATE.applied;
  const hubApi = hubWin?.__showcaseHub;

  // 1. Before/After skin toggle on /hub
  if (desired.skinEnabled !== ap.skinEnabled && hubDoc) {
    ap.skinEnabled = desired.skinEnabled;
    if (hubApi?.setSkinEnabled) {
      try { await hubApi.setSkinEnabled(desired.skinEnabled); } catch {}
    } else {
      const stage = hubDoc.getElementById('agy-prism-stage');
      const styleEl = hubDoc.getElementById('agy-prism-css');
      if (!desired.skinEnabled) {
        hubDoc.documentElement.removeAttribute('data-agy-prism-skin');
        if (stage) stage.style.opacity = '0';
        if (styleEl) styleEl.disabled = true;
      } else {
        hubDoc.documentElement.setAttribute('data-agy-prism-skin', '1.0.0');
        if (stage) stage.style.opacity = '1';
        if (styleEl) styleEl.disabled = false;
      }
    }
  }

  // 2. Active wallpaper switch (hero Honkai3 vs alt SFW scenic)
  if (desired.activeId && desired.activeId !== ap.activeId) {
    ap.activeId = desired.activeId;
    if (hubApi?.applyWallpaper) {
      try { await hubApi.applyWallpaper(desired.activeId); } catch {}
    }
    if (studioDoc) {
      const card = studioDoc.querySelector(`[data-action="card-click"][data-id="${CSS.escape(desired.activeId)}"]`);
      if (card) {
        try { card.click(); } catch {}
      }
    }
  }

  // 3. Studio active tab ('library' | 'skin' | 'system')
  if (desired.studioTab && desired.studioTab !== ap.studioTab && studioDoc) {
    const tabBtn = studioDoc.querySelector(`[data-action="switch-tab"][data-tab="${desired.studioTab}"]`);
    if (tabBtn) {
      ap.studioTab = desired.studioTab;
      try { tabBtn.click(); } catch {}
      const sc = studioDoc.getElementById('prism-tab-scroll');
      if (sc) sc.scrollTop = 0;
    }
  }

  // 4. Hub Obsidian Prism optical config (layout, scheme, themeMode, blur, codeReadability, opacity)
  const cfgChanged =
    desired.layoutMode !== ap.layoutMode ||
    desired.colorScheme !== ap.colorScheme ||
    desired.themeMode !== ap.themeMode ||
    Math.abs((desired.backdropBlur ?? 0) - (ap.backdropBlur ?? -99)) > 0.25 ||
    desired.codeReadabilityMode !== ap.codeReadabilityMode ||
    Math.abs((desired.surfaceOpacity ?? 0.68) - (ap.popoverOpacity ?? -99)) > 0.02;

  if (cfgChanged) {
    const layoutChanged = desired.layoutMode !== ap.layoutMode;
    const schemeOrThemeChanged = desired.colorScheme !== ap.colorScheme || desired.themeMode !== ap.themeMode;
    ap.layoutMode = desired.layoutMode;
    ap.colorScheme = desired.colorScheme;
    ap.themeMode = desired.themeMode;
    ap.backdropBlur = desired.backdropBlur;
    ap.codeReadabilityMode = desired.codeReadabilityMode;
    ap.popoverOpacity = desired.surfaceOpacity;

    const patch = {
      skinEnabled: Boolean(desired.skinEnabled),
      layoutMode: desired.layoutMode || 'islands',
      islandGap: desired.layoutMode === 'flush' ? 0 : 8,
      workspacePad: desired.layoutMode === 'flush' ? 0 : 8,
      colorScheme: desired.colorScheme || 'prism-default',
      themeMode: desired.themeMode || 'dark',
      mediaBlur: Math.round(desired.backdropBlur ?? 0),
      blur: desired.backdropBlur ?? 1.5,
      backdropBlur: desired.backdropBlur ?? 1.5,
      scrimOpacity: desired.scrimOpacity ?? 0.26,
      surfaceOpacity: desired.surfaceOpacity ?? 0.68,
      codeReadabilityMode: desired.codeReadabilityMode || 'frosted',
      accentMode: desired.colorScheme === 'nord' ? 'scheme' : 'dynamic',
    };

    if (hubDoc) {
      const isLight = desired.themeMode === 'light';
      hubDoc.body.classList.toggle('light', isLight);
      hubDoc.body.classList.toggle('dark', !isLight);
    }
    if (hubApi) {
      try {
        if (schemeOrThemeChanged && hubApi.setScheme) {
          await hubApi.setScheme(patch.colorScheme, patch.themeMode);
        }
        if (layoutChanged && hubApi.setLayout) {
          await hubApi.setLayout(patch.layoutMode);
        }
        if (hubApi.applyConfig) {
          await hubApi.applyConfig(patch);
        }
      } catch {}
    }
    // Keep Studio layout buttons & Left Rail mediaBlur slider visually synced too
    if (studioDoc) {
      const layoutBtn = studioDoc.querySelector(`[data-action="set-enum"][data-key="layoutMode"][data-val="${desired.layoutMode}"]`);
      if (layoutBtn && !layoutBtn.classList.contains('is-active')) {
        try { layoutBtn.click(); } catch {}
      }
      const blurInput = studioDoc.querySelector('input[type="range"][data-key="mediaBlur"]');
      if (blurInput) {
        const bv = Math.round(desired.backdropBlur ?? 0);
        blurInput.value = String(bv);
        const valEl = blurInput.closest('.prism-slider-row, .prism-control-row')?.querySelector('.prism-slider-val');
        if (valEl) valEl.textContent = `${bv} px`;
      }
    }
  }

  // 5. Quick Prism Popover open/close inside /hub
  if (desired.popoverOpen !== ap.popoverOpen) {
    ap.popoverOpen = desired.popoverOpen;
    try {
      if (desired.popoverOpen) {
        if (hubApi?.openQuickPanel) hubApi.openQuickPanel();
        else hubWin?.__agyPrismPanel?.open?.();
      } else {
        if (hubApi?.closeQuickPanel) hubApi.closeQuickPanel();
        else hubWin?.__agyPrismPanel?.close?.();
      }
    } catch {}
  }

  // 6. Normal Shortcut Auto-Load button in /studio (Act 5 S13 — clicks real set-autostart button!)
  if (desired.normalShortcutEnabled !== ap.normalShortcutEnabled && studioDoc) {
    ap.normalShortcutEnabled = desired.normalShortcutEnabled;
    if (desired.normalShortcutEnabled) {
      const btn = studioDoc.querySelector(
        '[data-action="set-autostart"][data-enabled="true"], [data-action="enable-normal-shortcut"], .prism-autostart-banner .prism-btn-primary',
      );
      if (btn) {
        try {
          btn.click();
          await new Promise((r) => setTimeout(r, 90));
        } catch {}
      }
    }
  }

  // 7. Hover highlight on active card in /studio (S06)
  if (desired.cardHoverId !== ap.cardHoverId && studioDoc) {
    ap.cardHoverId = desired.cardHoverId;
    for (const c of studioDoc.querySelectorAll('.prism-card-demo-hover')) {
      c.classList.remove('prism-card-demo-hover');
      c.style.boxShadow = '';
      c.style.transform = '';
    }
    if (desired.cardHoverId) {
      const card = studioDoc.querySelector(`[data-action="card-click"][data-id="${CSS.escape(desired.cardHoverId)}"]`);
      if (card) {
        card.classList.add('prism-card-demo-hover');
        card.style.boxShadow = '0 0 0 2.5px #93c5fd, 0 14px 36px rgba(102,157,246,0.55)';
        card.style.transform = 'translateY(-4px) scale(1.03)';
      }
    }
  }
}

function getShotBounds(actionName, fallbackStart, fallbackEnd) {
  const s = STATE.shotMap.get(actionName);
  if (s) return { start: s.startSec, end: s.endSec, slotEnd: s.slotEndSec, shot: s };
  return { start: fallbackStart, end: fallbackEnd, slotEnd: fallbackEnd + 0.35, shot: null };
}

function setTransform(node, x, y, scale, rx = 0, ry = 0, rz = 0) {
  node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0px) scale(${scale.toFixed(4)}) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
}

function renderRipples(x, y, dt) {
  const rings = [
    { el: DOM.ripple1, delay: 0.0, dur: 0.58, maxScale: 1.9 },
    { el: DOM.ripple2, delay: 0.08, dur: 0.62, maxScale: 2.5 },
    { el: DOM.ripple3, delay: 0.16, dur: 0.66, maxScale: 3.1 },
  ];
  for (const r of rings) {
    const p = (dt - r.delay) / r.dur;
    if (p > 0 && p < 1) {
      const e = easeOutCubic(p);
      r.el.style.opacity = String((1 - e) * 0.92);
      r.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(0.28 + e * r.maxScale).toFixed(3)})`;
    } else {
      r.el.style.opacity = '0';
    }
  }
}

function hideAllRipples() {
  DOM.ripple1.style.opacity = '0';
  DOM.ripple2.style.opacity = '0';
  DOM.ripple3.style.opacity = '0';
}

// Compute active shot + exact deterministic visuals at time tSec
async function renderFrameAt(tSec) {
  const t = clamp(tSec, 0, STATE.totalDurationSec);
  const en = sampleEnergy(t);

  // Locate shot anchors from real timeline.json
  const s01 = getShotBounds('cold_open_dark_ide_shatter', 0.4, 3.8);
  const s02 = getShotBounds('prism_refraction_burst_reveal_honkai3', 4.15, 8.95);
  const s03 = getShotBounds('hero_islands_3d_sweep', 9.3, 14.3);
  const s04 = getShotBounds('open_sidecar_studio_pane', 14.8, 20.4);
  const s05 = getShotBounds('steam_library_autoscan_highlight', 20.75, 27.55);
  const s06 = getShotBounds('cursor_click_honkai3_card', 28.0, 32.6);
  const s07 = getShotBounds('fast_switch_speed_badge_and_preview', 33.0, 38.0);
  const s08 = getShotBounds('dynamic_chroma_accent_and_left_rail', 38.35, 43.65);
  const s09 = getShotBounds('toggle_islands_flush_macro_gap', 44.1, 49.2);
  const s10 = getShotBounds('switch_scheme_dark_to_nord_light', 49.55, 54.65);
  const s11 = getShotBounds('macro_zoom_code_terminal_wcag', 55.0, 59.8);
  const s12 = getShotBounds('hotkey_ctrl_alt_w_quick_popover', 60.25, 66.05);
  const s13 = getShotBounds('click_normal_shortcut_autoload_success', 66.45, 72.15);
  const s14 = getShotBounds('opensource_github_hero_card', 72.65, 77.85);
  const s15 = getShotBounds('bilibili_triple_cta_outro', 78.2, STATE.totalDurationSec);

  const heroId = STATE.heroItem?.id || 'ws-2876797752';
  const altId = STATE.altItem?.id || heroId;

  // Reveal boundary (right on the S02 hit)
  const revealT = Math.max(3.85, s02.start - 0.15);
  const clickHonkaiT = lerp(s06.start, s06.end, 0.72);
  const nordFlipT = lerp(s10.start, s10.end, 0.44);
  const nordEndT = s11.start - 0.12;
  const popoverTriggerT = lerp(s12.start, s12.end, 0.40);
  const shortcutClickT = lerp(s13.start, s13.end, 0.46);

  // Determine current active line for subtitles & step callout
  let activeLine = null;
  for (const sh of STATE.shots) {
    if (t >= sh.startSec - 0.08 && t <= sh.endSec + 0.25) {
      activeLine = sh;
      break;
    }
  }
  let currentSlot = STATE.shots[0] || null;
  for (const sh of STATE.shots) {
    if (t >= sh.startSec - 0.15) currentSlot = sh;
  }

  // Default state values
  let cam = { x: 0, y: 0, scale: 1.0, rx: 0, ry: 0, rz: 0 };
  let hubGeom = { left: 140, top: 76, width: 1640, height: 856, opacity: 1, rx: 0, ry: 0, scale: 1, z: 0 };
  let studioGeom = { left: 1020, top: 76, width: 820, height: 856, opacity: 0, tx: 220, rx: 0, ry: 0, scale: 1 };
  let lightMode = 0;
  let burst = 0;
  let sweep = 0;
  let ambientOpacity = 0;
  let accent = [0.40, 0.62, 0.96];
  let cursor = { visible: false, x: 960, y: 540, clickDt: -1, scale: 1 };

  // Declarative real UI state
  const ui = {
    skinEnabled: t >= revealT,
    activeId: heroId,
    studioTab: 'library',
    layoutMode: 'islands',
    colorScheme: 'prism-default',
    themeMode: 'dark',
    backdropBlur: 1.5,
    scrimOpacity: 0.26,
    surfaceOpacity: 0.68,
    codeReadabilityMode: 'frosted',
    popoverOpen: false,
    normalShortcutEnabled: false,
    cardHoverId: null,
  };

  // Reset contextual overlays & filter deterministically across parallel worker shards
  DOM.hubFrame.style.filter = 'none';
  DOM.beforeVeil.style.opacity = '0';
  DOM.beforeFracture.style.opacity = '0';
  DOM.shatterLayer.style.opacity = '0';
  DOM.heroBanner.style.opacity = '0';
  DOM.heroBadgesRail.style.opacity = '0';
  DOM.metricPrimary.style.opacity = '0';
  DOM.metricSecondary.style.opacity = '0';
  DOM.macroCalliper.style.opacity = '0';
  DOM.wcagBadge.style.opacity = '0';
  DOM.schemeRibbon.style.opacity = '0';
  DOM.keycapStage.style.opacity = '0';
  DOM.shortcutToast.style.opacity = '0';
  DOM.outroPanel.style.opacity = '0';
  DOM.tripleCtaDock.style.opacity = '0';
  DOM.chromaticWipe.style.opacity = '0';
  hideAllRipples();

  // =========================================================================
  // ACT 1: S01 (Cold Open Before) -> S02 (Shatter Reveal) -> S03 (3D Sweep)
  // =========================================================================
  if (t < revealT) {
    const p = clamp(t / revealT, 0, 1);
    cam = { x: 0, y: 8, scale: lerp(0.95, 1.03, easeInOutCubic(p)), rx: 1.5, ry: lerp(-2.5, 0, p), rz: 0 };
    DOM.beforeVeil.style.opacity = String(lerp(0.32, 0.42, p));
    DOM.hubFrame.style.filter = 'saturate(0.35) brightness(0.84) contrast(1.04)';
    DOM.hubBadgeText.textContent = 'Default Dark · 无壁纸模式';

    // Fracture light charge right before shatter hit
    const charge = smoothstep(revealT - 0.52, revealT, t);
    if (charge > 0.01) {
      DOM.beforeFracture.style.opacity = String(charge);
      DOM.beforeFracture.style.transform = `scaleY(${(0.3 + charge * 0.9).toFixed(3)})`;
      burst = charge * 0.45;
    }
  } else if (t < s03.start) {
    // S02: Explosive Shatter & Reveal!
    const p = clamp((t - revealT) / Math.max(0.5, s03.start - revealT), 0, 1);
    const dtReveal = t - revealT;
    DOM.hubFrame.style.filter = 'none';
    DOM.hubBadgeText.textContent = 'Wallpaper Prism v1.1.0 · Floating Islands';
    ambientOpacity = lerp(0.55, 0.28, easeOutCubic(p));
    burst = Math.exp(-dtReveal * 3.4);
    sweep = clamp(dtReveal / 0.72, 0, 1);

    // Chromatic diagonal wipe
    if (dtReveal < 0.72) {
      const wp = dtReveal / 0.72;
      DOM.chromaticWipe.style.opacity = String(Math.sin(wp * Math.PI) * 0.85);
      DOM.chromaticWipe.style.transform = `translate3d(${lerp(-1400, 1400, wp).toFixed(1)}px, 0, 0)`;
    }

    // Crystal glass shards burst radially outward
    if (dtReveal < 1.15) {
      const sp = easeOutCubic(dtReveal / 1.15);
      DOM.shatterLayer.style.opacity = String((1 - sp) * 0.95);
      for (const sh of SHARDS) {
        const dx = Math.cos(sh.angle) * sh.speed * sp;
        const dy = Math.sin(sh.angle) * sh.speed * sp;
        sh.el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) rotate(${(sh.spin * sp).toFixed(1)}deg) scale(${(1.08 - sp * 0.45).toFixed(3)})`;
      }
    }

    // Hero 3D elastic pullback
    const e = easeOutCubic(Math.min(1, dtReveal / 1.4));
    cam = {
      x: lerp(0, -18, e),
      y: lerp(14, 34, e),
      scale: lerp(1.09, 0.95, e),
      rx: lerp(2, 6.5, e),
      ry: lerp(0, -8.5, e),
      rz: lerp(0, -0.6, e),
    };

    // Hero brand banner floats cleanly at top
    const bannerIn = smoothstep(0.22, 0.75, dtReveal);
    const bannerOut = 1 - smoothstep(s03.start - 0.65, s03.start - 0.05, t);
    const bOp = bannerIn * bannerOut;
    DOM.heroBanner.style.opacity = String(bOp.toFixed(3));
    DOM.heroBanner.style.transform = `translate(-50%, ${lerp(-28, 0, easeOutBack(bannerIn)).toFixed(1)}px) scale(${lerp(0.92, 1.0, easeOutCubic(bannerIn)).toFixed(3)})`;
  } else if (t < s04.start) {
    // S03: Hero 3D Arc Sweep + 3 Feature Badges
    const p = clamp((t - s03.start) / Math.max(0.5, s04.start - s03.start), 0, 1);
    DOM.hubFrame.style.filter = 'none';
    ambientOpacity = 0.24;
    cam = {
      x: lerp(-24, -68, easeInOutCubic(p)),
      y: lerp(24, 6, easeInOutCubic(p)),
      scale: lerp(0.95, 1.04, easeInOutCubic(p)),
      rx: lerp(6.5, 3.2, p),
      ry: lerp(-8.5, 6.8, easeInOutCubic(p)),
      rz: lerp(-0.5, 0.4, p),
    };

    DOM.heroBadgesRail.style.opacity = '1';
    const badges = [DOM.hb1, DOM.hb2, DOM.hb3];
    badges.forEach((b, idx) => {
      const bp = smoothstep(idx * 0.12, idx * 0.12 + 0.22, p) * (1 - smoothstep(0.90, 1.0, p));
      b.style.opacity = String(bp.toFixed(3));
      b.style.transform = `translate3d(${lerp(46, 0, easeOutCubic(bp)).toFixed(1)}px, 0, 0)`;
    });

  // =========================================================================
  // ACT 2: S04 (Open Studio Split-Screen) -> S05 (Steam 431960 Auto-Scan)
  // =========================================================================
  } else if (t < s05.start) {
    const p = clamp((t - s04.start) / Math.max(0.5, s05.start - s04.start), 0, 1);
    const splitP = easeInOutCubic(smoothstep(0.22, 0.58, p));
    if (p < 0.25) sweep = p / 0.25;

    hubGeom = {
      left: lerp(140, 44, splitP),
      top: 78,
      width: lerp(1640, 816, splitP),
      height: 848,
      opacity: 1,
      rx: 0,
      ry: lerp(0, 2.5, splitP),
      scale: 1,
      z: 0,
    };
    studioGeom = {
      left: lerp(1880, 884, splitP),
      top: 78,
      width: 992,
      height: 848,
      opacity: smoothstep(0.18, 0.45, p),
      tx: lerp(120, 0, splitP),
      rx: 0,
      ry: lerp(-8, -1.8, splitP),
      scale: 1,
    };
    cam = {
      x: lerp(0, -16, easeInOutCubic(p)),
      y: 0,
      scale: lerp(1.0, 1.03, easeInOutCubic(p)),
      rx: 1.2,
      ry: lerp(2, -1.5, p),
      rz: 0,
    };

    // Virtual cursor clicks top-right Wallpaper Prism launcher button
    const cp = clamp(p / 0.34, 0, 1);
    cursor = {
      visible: p < 0.78,
      x: bezier2(960, 1340, 1690, easeInOutCubic(cp)),
      y: bezier2(540, 220, 108, easeInOutCubic(cp)),
      clickDt: t - (s04.start + (s05.start - s04.start) * 0.24),
      scale: 1,
    };
  } else if (t < s06.start) {
    // S05: Steam 431960 Auto-Scan Highlight + 8.3ms Cold-Boot Telemetry
    const p = clamp((t - s05.start) / Math.max(0.5, s06.start - s05.start), 0, 1);
    hubGeom = { left: 44, top: 78, width: 816, height: 848, opacity: 0.92, rx: 0, ry: 2.5, scale: 1, z: 0 };
    studioGeom = { left: 884, top: 78, width: 992, height: 848, opacity: 1, tx: 0, rx: 0, ry: -1.2, scale: 1 };
    const zoomP = easeInOutCubic(smoothstep(0.0, 0.35, p));
    cam = {
      x: lerp(-16, -240, zoomP),
      y: lerp(0, 18, zoomP),
      scale: lerp(1.03, 1.15, zoomP),
      rx: 1.5,
      ry: -2.2,
      rz: 0,
    };

    // Cursor clicks refresh (↻) button in Studio toolbar
    const clickP = 0.30;
    const moveP = easeInOutCubic(clamp(p / clickP, 0, 1));
    cursor = {
      visible: p < 0.85,
      x: bezier2(1690, 1745, 1738, moveP),
      y: bezier2(108, 165, 202, moveP),
      clickDt: t - (s05.start + (s06.start - s05.start) * clickP),
      scale: 1,
    };

    // Show 8.3ms cold-boot telemetry card after scan click
    const metIn = smoothstep(clickP, clickP + 0.16, p);
    DOM.metricPrimary.style.opacity = String(metIn.toFixed(3));
    DOM.metricPrimary.style.transform = `translate3d(${lerp(36, 0, easeOutCubic(metIn)).toFixed(1)}px, 0, 0)`;
    DOM.metricVal.textContent = '8.3ms';
    DOM.metricTitle.textContent = 'Steam 431960 自动发现';
    DOM.metricSub.textContent = 'ZERO-SPAWN · MP4 / PKGV / WEB / IMG';

  // =========================================================================
  // ACT 3: S06 (Click Honkai3!) -> S07 (2.5ms Faststart) -> S08 (32x32 Accent)
  // =========================================================================
  } else if (t < s07.start) {
    const p = clamp((t - s06.start) / Math.max(0.5, s07.start - s06.start), 0, 1);
    const clicked = t >= clickHonkaiT;
    ui.activeId = clicked ? heroId : altId;
    ui.cardHoverId = !clicked && p > 0.35 ? heroId : null;

    hubGeom = { left: 44, top: 78, width: 816, height: 848, opacity: 1, rx: 0, ry: 2.2, scale: 1, z: 0 };
    studioGeom = { left: 884, top: 78, width: 992, height: 848, opacity: 1, tx: 0, rx: 0, ry: -1.4, scale: 1 };

    const pushIn = easeInOutCubic(clamp(p / 0.72, 0, 1));
    const slamOut = clicked ? easeOutCubic(clamp((t - clickHonkaiT) / 0.55, 0, 1)) : 0;
    cam = {
      x: lerp(-240, -290, pushIn) + slamOut * 140,
      y: lerp(18, -14, pushIn) + slamOut * 14,
      scale: lerp(1.15, 1.24, pushIn) - slamOut * 0.16,
      rx: lerp(1.5, 2.8, pushIn),
      ry: lerp(-2.2, -3.5, pushIn) + slamOut * 3.0,
      rz: 0,
    };

    if (clicked) {
      const dtC = t - clickHonkaiT;
      burst = Math.exp(-dtC * 4.5) * 0.92;
      sweep = clamp(dtC / 0.5, 0, 1);
    }

    // Cursor glides onto Card #1 (崩坏3周年庆) and clicks right on beat
    const hoverMove = easeInOutCubic(clamp(p / 0.58, 0, 1));
    cursor = {
      visible: true,
      x: bezier2(1520, 1460, 1365, hoverMove),
      y: bezier2(255, 360, 442, hoverMove),
      clickDt: t - clickHonkaiT,
      scale: clicked && t - clickHonkaiT < 0.14 ? 0.88 : 1,
    };
  } else if (t < s08.start) {
    // S07: 2.5ms Fast-Switch & Dual-Screen 60fps Sync
    const p = clamp((t - s07.start) / Math.max(0.5, s08.start - s07.start), 0, 1);
    hubGeom = { left: 44, top: 78, width: 880, height: 848, opacity: 1, rx: 0, ry: 3.2, scale: 1, z: 0 };
    studioGeom = { left: 948, top: 78, width: 928, height: 848, opacity: 1, tx: 0, rx: 0, ry: -3.2, scale: 1 };
    cam = {
      x: lerp(-80, 10, easeInOutCubic(p)),
      y: 6,
      scale: lerp(1.04, 1.0, easeInOutCubic(p)),
      rx: 2.2,
      ry: lerp(3.8, -3.2, easeInOutCubic(p)),
      rz: 0,
    };

    const metIn = smoothstep(0.05, 0.25, p);
    DOM.metricPrimary.style.opacity = String(metIn.toFixed(3));
    DOM.metricPrimary.style.transform = `translate3d(${lerp(34, 0, easeOutCubic(metIn)).toFixed(1)}px, 0, 0)`;
    const msAnim = lerp(18.0, 2.5, easeOutCubic(clamp(p / 0.35, 0, 1)));
    DOM.metricVal.textContent = `${msAnim.toFixed(1)}ms`;
    DOM.metricTitle.textContent = '零拷贝 MP4 Faststart';
    DOM.metricSub.textContent = 'HTTP 206 RANGE · ZERO-FLICKER SWITCH';
  } else if (t < s09.start) {
    // S08: 32x32 Dynamic Chroma Accent + Left Rail Blur Slider & Playlist Queue
    const p = clamp((t - s08.start) / Math.max(0.5, s09.start - s08.start), 0, 1);
    hubGeom = { left: 44, top: 78, width: 880, height: 848, opacity: 1, rx: 0, ry: 2.0, scale: 1, z: 0 };
    studioGeom = { left: 948, top: 78, width: 928, height: 848, opacity: 1, tx: 0, rx: 0, ry: -1.5, scale: 1 };

    // Live blur slider demo (0px -> 14px -> 2px)
    const blurWave = Math.sin(clamp((p - 0.18) / 0.62, 0, 1) * Math.PI);
    ui.backdropBlur = lerp(0, 14.0, blurWave);
    accent = [0.68, 0.50, 0.96]; // Radiant Honkai3 violet-blue dynamic accent!

    const zIn = easeInOutCubic(smoothstep(0.0, 0.28, p));
    cam = {
      x: lerp(10, -140, zIn),
      y: lerp(6, -34, zIn),
      scale: lerp(1.0, 1.18, zIn),
      rx: 1.5,
      ry: -2.0,
      rz: 0,
    };

    // Cursor drags real 壁纸柔焦模糊 slider knob across Studio Left Rail (y ~ 714px)
    const dragX = lerp(846, 1110, blurWave);
    cursor = {
      visible: p > 0.12 && p < 0.92,
      x: dragX,
      y: lerp(714, 795, smoothstep(0.76, 0.92, p)),
      clickDt: t - (s08.start + (s09.start - s08.start) * 0.22),
      scale: 1,
    };

    const metIn = smoothstep(0.08, 0.28, p);
    DOM.metricSecondary.style.opacity = String(metIn.toFixed(3));
    DOM.metricSecondary.style.transform = `translate3d(${lerp(36, 0, easeOutCubic(metIn)).toFixed(1)}px, 0, 0)`;
    DOM.metric2Title.textContent = '32×32 动态壁纸取色 · 轮播队列';
    DOM.metric2Sub.textContent = `LIVE BLUR ${Math.round(ui.backdropBlur)}px · DYNAMIC ACCENT`;

  // =========================================================================
  // ACT 4: S09 (Islands <-> Flush Macro) -> S10 (Nord Light Frost) -> S11 (WCAG)
  // =========================================================================
  } else if (t < s10.start) {
    const p = clamp((t - s09.start) / Math.max(0.5, s10.start - s09.start), 0, 1);
    ui.studioTab = 'skin';
    const isFlush = p >= 0.36 && p <= 0.72;
    ui.layoutMode = isFlush ? 'flush' : 'islands';

    if (p < 0.16) sweep = p / 0.16;

    hubGeom = { left: 44, top: 78, width: 1020, height: 848, opacity: 1, rx: 0, ry: 2.0, scale: 1, z: 0 };
    studioGeom = { left: 1088, top: 78, width: 788, height: 848, opacity: 1, tx: 0, rx: 0, ry: -2.2, scale: 1 };

    // Macro zoom onto Hub's 8px Floating Island Glass Gap + visible Studio layout toggle!
    const macroIn = easeInOutCubic(smoothstep(0.08, 0.32, p));
    cam = {
      x: lerp(-80, 260, macroIn),
      y: lerp(-10, 24, macroIn),
      scale: lerp(1.06, 1.32, macroIn),
      rx: 1.4,
      ry: 2.0,
      rz: 0,
    };

    // Show animated precision 8px <-> 0px calliper directly on the sidebar|chat island gap!
    const calOp = smoothstep(0.16, 0.30, p) * (1 - smoothstep(0.92, 1.0, p));
    DOM.macroCalliper.style.opacity = String(calOp.toFixed(3));
    DOM.calliperBar.style.width = isFlush ? '4px' : '28px';
    DOM.calliperPill.textContent = isFlush ? '紧凑一体 Flush · 0px 无缝合拢' : '浮岛画境 Islands · 8px 光学缝隙';

    // Cursor clicks Studio's Floating Islands preset / layout toggle on right side
    const firstClickT = s09.start + (s10.start - s09.start) * 0.36;
    const secondClickT = s09.start + (s10.start - s09.start) * 0.72;
    const clickDt = t >= secondClickT - 0.05 ? (t - secondClickT) : (t - firstClickT);
    cursor = {
      visible: p > 0.12 && p < 0.90,
      x: p < 0.56 ? 1745 : 1685,
      y: 356,
      clickDt,
      scale: 1,
    };
  } else if (t < s11.start) {
    // S10: 4 Presets + 8 Paired Schemes -> Diagonal Frost Wipe to Light Frost Nord!
    const p = clamp((t - s10.start) / Math.max(0.5, s11.start - s10.start), 0, 1);
    const isNordLight = t >= nordFlipT;
    ui.studioTab = 'skin';
    ui.layoutMode = 'islands';
    ui.colorScheme = isNordLight ? 'nord' : 'prism-default';
    ui.themeMode = isNordLight ? 'light' : 'dark';
    lightMode = smoothstep(nordFlipT - 0.05, nordFlipT + 0.52, t);
    if (isNordLight) accent = [0.53, 0.75, 0.82];

    const dtFlip = t - nordFlipT;
    if (dtFlip >= 0 && dtFlip < 0.70) {
      const wp = dtFlip / 0.70;
      sweep = wp;
      DOM.chromaticWipe.style.opacity = String(Math.sin(wp * Math.PI) * 0.82);
      DOM.chromaticWipe.style.transform = `translate3d(${lerp(-1400, 1400, wp).toFixed(1)}px, 0, 0)`;
    }

    hubGeom = { left: 100, top: 92, width: 1720, height: 834, opacity: 1, rx: 0, ry: 0, scale: 1, z: 0 };
    studioGeom = { left: 1920, top: 92, width: 788, height: 834, opacity: 0, tx: 180, rx: 0, ry: 0, scale: 1 };

    cam = {
      x: 0,
      y: 0,
      scale: lerp(1.03, 0.98, easeInOutCubic(p)),
      rx: 2.5,
      ry: lerp(-5.2, 5.2, easeInOutCubic(p)),
      rz: 0,
    };

    // Scheme Matrix Ribbon at top center
    const ribIn = smoothstep(0.05, 0.20, p) * (1 - smoothstep(0.90, 1.0, p));
    DOM.schemeRibbon.style.opacity = String(ribIn.toFixed(3));
    DOM.schemeRibbon.classList.toggle('is-light', lightMode > 0.5);
    DOM.schemeRibbonLabel.textContent = isNordLight ? '极地冰川 Nord · Light Frost 浅霜' : '深空黑曜 · Dark Obsidian';
    for (const chip of DOM.schemeRibbon.querySelectorAll('.scheme-chip')) {
      chip.classList.toggle('is-active', chip.dataset.scheme === (isNordLight ? 'nord' : 'prism-default'));
    }

    cursor = {
      visible: p > 0.16 && p < 0.68,
      x: lerp(830, 916, easeInOutCubic(clamp((p - 0.16) / 0.28, 0, 1))),
      y: 48,
      clickDt: t - nordFlipT,
      scale: 1,
    };
  } else if (t < s12.start) {
    // S11: WCAG Code & Terminal Readability Macro Zoom
    const p = clamp((t - s11.start) / Math.max(0.5, s12.start - s11.start), 0, 1);
    lightMode = 1 - smoothstep(s11.start, s11.start + 0.42, t);
    ui.colorScheme = 'prism-default';
    ui.themeMode = 'dark';
    ui.layoutMode = 'islands';
    ui.codeReadabilityMode = p < 0.35 ? 'translucent' : 'frosted';

    hubGeom = { left: 140, top: 76, width: 1640, height: 856, opacity: 1, rx: 0, ry: 0, scale: 1, z: 0 };
    studioGeom = { left: 1960, top: 76, width: 820, height: 856, opacity: 0, tx: 200, rx: 0, ry: 0, scale: 1 };

    // Macro zoom squarely onto code block & xterm terminal inside /hub
    const zIn = easeInOutCubic(smoothstep(0.0, 0.36, p));
    cam = {
      x: lerp(0, -140, zIn),
      y: lerp(0, -135, zIn),
      scale: lerp(1.0, 1.44, zIn),
      rx: lerp(2.5, 1.0, zIn),
      ry: lerp(3.5, -1.5, zIn),
      rz: 0,
    };

    const badgeOp = smoothstep(0.22, 0.42, p) * (1 - smoothstep(0.88, 1.0, p));
    DOM.wcagBadge.style.opacity = String(badgeOp.toFixed(3));
    DOM.wcagGrade.textContent = p < 0.35 ? 'AA+' : 'AAA';
    DOM.wcagTitle.textContent = p < 0.35 ? '通透微透 · WCAG 保护已启用' : '磨砂护眼 · WCAG 对比度底限 ✓';
    DOM.wcagSub.textContent = p < 0.35 ? 'CONTRAST 8.6:1 · GLASS CODE' : 'CONTRAST 12.4:1 · RAZOR SHARP';

  // =========================================================================
  // ACT 5: S12 (Ctrl+Alt+W Quick Popover) -> S13 (1-Click Shortcut Auto-Load)
  // =========================================================================
  } else if (t < s13.start) {
    const p = clamp((t - s12.start) / Math.max(0.5, s13.start - s12.start), 0, 1);
    const popped = t >= popoverTriggerT;
    ui.popoverOpen = popped;
    ui.layoutMode = 'islands';
    ui.colorScheme = 'prism-default';
    ui.themeMode = 'dark';
    // Gently breathe surfaceOpacity after popover opens
    ui.surfaceOpacity = popped ? lerp(0.68, 0.48, Math.sin(clamp((t - popoverTriggerT) / 2.6, 0, 1) * Math.PI)) : 0.68;

    hubGeom = { left: 100, top: 74, width: 1720, height: 856, opacity: 1, rx: 0, ry: 0, scale: 1, z: 0 };
    studioGeom = { left: 1960, top: 74, width: 820, height: 856, opacity: 0, tx: 240, rx: 0, ry: 0, scale: 1 };

    const focusPop = popped ? easeInOutCubic(clamp((t - popoverTriggerT) / 0.7, 0, 1)) : 0;
    cam = {
      x: lerp(0, 96, focusPop),
      y: lerp(0, -12, focusPop),
      scale: lerp(1.01, 1.08, focusPop),
      rx: 1.4,
      ry: lerp(-1.2, 2.0, focusPop),
      rz: 0,
    };

    // 3D Mechanical Keycaps: Ctrl -> Alt -> W press animation!
    const kcIn = smoothstep(0.05, 0.20, p) * (1 - smoothstep(0.62, 0.76, p));
    DOM.keycapStage.style.opacity = String(kcIn.toFixed(3));
    DOM.keycapStage.style.transform = `translate(-50%, ${lerp(24, 0, easeOutCubic(kcIn)).toFixed(1)}px)`;
    DOM.keyCtrl.classList.toggle('is-pressed', p >= 0.22 && p <= 0.56);
    DOM.keyAlt.classList.toggle('is-pressed', p >= 0.30 && p <= 0.56);
    DOM.keyW.classList.toggle('is-pressed', p >= 0.38 && p <= 0.56);

    if (popped && t - popoverTriggerT < 0.6) {
      burst = Math.exp(-(t - popoverTriggerT) * 5.0) * 0.6;
    }

    // Cursor glides onto Quick Prism Popover opacity slider on left panel!
    if (popped) {
      const m = clamp((t - popoverTriggerT) / 2.6, 0, 1);
      cursor = {
        visible: true,
        x: lerp(295, 455, Math.sin(m * Math.PI)),
        y: 678,
        clickDt: t - popoverTriggerT,
        scale: 1,
      };
    }
  } else if (t < s14.start) {
    // S13: 1-Click Normal Shortcut Auto-Load (Zero Session Interruption)
    const p = clamp((t - s13.start) / Math.max(0.5, s14.start - s13.start), 0, 1);
    const enabled = t >= shortcutClickT;
    ui.popoverOpen = false;
    ui.studioTab = 'system';
    ui.normalShortcutEnabled = enabled;

    hubGeom = { left: 44, top: 78, width: 760, height: 848, opacity: 0.75, rx: 0, ry: 4.0, scale: 0.96, z: 0 };
    studioGeom = { left: 828, top: 78, width: 1048, height: 848, opacity: 1, tx: 0, rx: 0, ry: -1.5, scale: 1 };

    const zIn = easeInOutCubic(smoothstep(0.0, 0.32, p));
    cam = {
      x: lerp(-80, -210, zIn),
      y: lerp(0, 72, zIn),
      scale: lerp(1.04, 1.18, zIn),
      rx: 1.4,
      ry: -1.8,
      rz: 0,
    };

    // Cursor clicks the bright blue primary auto-load CTA button dead-center!
    const moveP = easeInOutCubic(clamp(p / 0.44, 0, 1));
    cursor = {
      visible: p < 0.88,
      x: bezier2(1620, 1460, 1326, moveP),
      y: bezier2(640, 520, 444, moveP),
      clickDt: t - shortcutClickT,
      scale: enabled && t - shortcutClickT < 0.14 ? 0.88 : 1,
    };

    if (enabled) {
      const dtE = t - shortcutClickT;
      burst = Math.exp(-dtE * 4.2) * 0.75;
      accent = [0.31, 0.78, 0.56]; // Emerald confirmation glow!
      const toastIn = smoothstep(0.05, 0.35, dtE);
      DOM.shortcutToast.style.opacity = String(toastIn.toFixed(3));
      DOM.shortcutToast.style.transform = `translate(-50%, ${lerp(28, 0, easeOutBack(toastIn)).toFixed(1)}px)`;
    }

  // =========================================================================
  // ACT 6: S14 (Open-Source GitHub Hero) -> S15 (Mambo Triple CTA & Fade Out)
  // =========================================================================
  } else {
    const dtAct6 = t - s14.start;
    const isCta = t >= s15.start - 0.15;
    ui.popoverOpen = false;
    ui.layoutMode = 'islands';
    ui.colorScheme = 'prism-default';
    ui.themeMode = 'dark';
    ambientOpacity = 0.42;

    if (dtAct6 < 0.75) {
      burst = Math.exp(-dtAct6 * 3.4);
      sweep = dtAct6 / 0.75;
      DOM.chromaticWipe.style.opacity = String(Math.sin(sweep * Math.PI) * 0.78);
      DOM.chromaticWipe.style.transform = `translate3d(${lerp(-1400, 1400, sweep).toFixed(1)}px, 0, 0)`;
    }

    // Left: tilted 3D Floating Islands Hub showcase; Right: Monumental GitHub Hero Card
    hubGeom = {
      left: 56,
      top: 126,
      width: 920,
      height: 740,
      opacity: 1,
      rx: 5.5,
      ry: 13.5,
      scale: 0.96,
      z: 0,
    };
    studioGeom = { left: 1980, top: 78, width: 820, height: 848, opacity: 0, tx: 260, rx: 0, ry: 0, scale: 1 };

    const floatOsc = Math.sin(dtAct6 * 1.4) * 6;
    cam = {
      x: 0,
      y: floatOsc * 0.4,
      scale: 1.0,
      rx: 1.0,
      ry: Math.sin(dtAct6 * 0.7) * 1.6,
      rz: 0,
    };

    const cardIn = smoothstep(0.08, 0.55, dtAct6);
    const shiftUp = isCta ? easeInOutCubic(clamp((t - (s15.start - 0.15)) / 0.55, 0, 1)) : 0;
    DOM.outroPanel.style.opacity = String(cardIn.toFixed(3));
    DOM.outroPanel.style.transform = `translate3d(${lerp(56, 0, easeOutCubic(cardIn)).toFixed(1)}px, ${lerp(0, -34, shiftUp).toFixed(1)}px, 0)`;

    if (isCta) {
      const dtCta = Math.max(0, t - s15.start);
      const ctaIn = smoothstep(0.0, 0.45, dtCta);
      DOM.tripleCtaDock.style.opacity = String(ctaIn.toFixed(3));
      DOM.tripleCtaDock.style.transform = `translate3d(0, ${lerp(36, 0, easeOutBack(ctaIn)).toFixed(1)}px, 0)`;

      const likeLit = dtCta >= 0.70;
      const coinLit = dtCta >= 1.25;
      const favLit = dtCta >= 1.80;
      DOM.ctaLike.classList.toggle('is-lit-like', likeLit);
      DOM.ctaCoin.classList.toggle('is-lit-coin', coinLit);
      DOM.ctaFav.classList.toggle('is-lit-fav', favLit);

      // Virtual cursor sweeps across Like -> Coin -> Fav lighting up triple combo!
      if (dtCta > 0.25 && dtCta < 2.95) {
        const cp = clamp((dtCta - 0.25) / 1.85, 0, 1);
        const cx = lerp(1110, 1450, easeInOutCubic(cp));
        let clickDt = -1;
        if (Math.abs(dtCta - 0.70) < 0.65 && dtCta >= 0.70) clickDt = dtCta - 0.70;
        else if (Math.abs(dtCta - 1.25) < 0.65 && dtCta >= 1.25) clickDt = dtCta - 1.25;
        else if (dtCta >= 1.80) clickDt = dtCta - 1.80;
        cursor = { visible: true, x: cx, y: 676, clickDt, scale: 1 };
      }
    }
  }

  // Keep Hub window status badge 100% synchronized with live UI state across all shards
  if (!ui.skinEnabled) {
    DOM.hubBadgeText.textContent = 'Default Dark · 无壁纸模式';
  } else if (ui.themeMode === 'light' && ui.colorScheme === 'nord') {
    DOM.hubBadgeText.textContent = 'Wallpaper Prism v1.1.0 · Light Frost Nord';
  } else if (ui.layoutMode === 'flush') {
    DOM.hubBadgeText.textContent = 'Wallpaper Prism v1.1.0 · Flush Integrated';
  } else {
    DOM.hubBadgeText.textContent = 'Wallpaper Prism v1.1.0 · Floating Islands';
  }

  // Apply real DOM state to /hub and /studio
  await reconcileRealUI(ui);

  // Sync exact frame of 崩坏3周年庆（动态） into ambient canvas + /hub + /studio
  const honkaiImg = await STATE.honkai.getFrameForTime(t);
  const isHonkaiActive = ui.activeId === heroId && ui.skinEnabled;
  syncHonkaiCanvases(honkaiImg, isHonkaiActive);
  if (ambientOpacity > 0.01 && honkaiImg) {
    DOM.ambientCanvas.style.opacity = String(ambientOpacity.toFixed(3));
    DOM.ambientScrim.style.opacity = String(Math.min(1, ambientOpacity * 1.4).toFixed(3));
    drawCover(STATE.ambientCtx, honkaiImg, 1920, 1080);
  } else {
    DOM.ambientCanvas.style.opacity = '0';
    DOM.ambientScrim.style.opacity = '0';
  }

  // Apply Hub & Studio geometry + Light mode shell styling
  const isLightShell = lightMode > 0.5;
  DOM.hubWindow.classList.toggle('is-light', isLightShell);
  DOM.studioWindow.classList.toggle('is-light', isLightShell);
  DOM.stepPill.classList.toggle('is-light', isLightShell);
  DOM.stepPill.classList.toggle('is-before', t < revealT);
  DOM.metricPrimary.classList.toggle('is-light', isLightShell);
  DOM.metricSecondary.classList.toggle('is-light', isLightShell);

  DOM.hubWindow.style.left = `${hubGeom.left.toFixed(1)}px`;
  DOM.hubWindow.style.top = `${hubGeom.top.toFixed(1)}px`;
  DOM.hubWindow.style.width = `${hubGeom.width.toFixed(1)}px`;
  DOM.hubWindow.style.height = `${hubGeom.height.toFixed(1)}px`;
  DOM.hubWindow.style.opacity = String(hubGeom.opacity.toFixed(3));
  setTransform(DOM.hubWindow, 0, 0, hubGeom.scale, hubGeom.rx, hubGeom.ry, 0);

  // Keep /hub iframe cleanly fitted inside hub viewport
  const hubVpW = Math.max(400, hubGeom.width);
  const hubVpH = Math.max(300, hubGeom.height - 36);
  const hubScale = Math.min(hubVpW / 1440, hubVpH / 820);
  DOM.hubFrame.style.width = `${Math.round(hubVpW / hubScale)}px`;
  DOM.hubFrame.style.height = `${Math.round(hubVpH / hubScale)}px`;
  DOM.hubFrame.style.transform = `scale(${hubScale.toFixed(4)})`;

  DOM.studioWindow.style.left = `${studioGeom.left.toFixed(1)}px`;
  DOM.studioWindow.style.top = `${studioGeom.top.toFixed(1)}px`;
  DOM.studioWindow.style.width = `${studioGeom.width.toFixed(1)}px`;
  DOM.studioWindow.style.height = `${studioGeom.height.toFixed(1)}px`;
  DOM.studioWindow.style.opacity = String(studioGeom.opacity.toFixed(3));
  setTransform(DOM.studioWindow, studioGeom.tx || 0, 0, studioGeom.scale, studioGeom.rx, studioGeom.ry, 0);

  const stVpW = Math.max(400, studioGeom.width);
  const stVpH = Math.max(300, studioGeom.height - 36);
  const stScale = Math.min(stVpW / 1040, stVpH / 820);
  DOM.studioFrame.style.width = `${Math.round(stVpW / stScale)}px`;
  DOM.studioFrame.style.height = `${Math.round(stVpH / stScale)}px`;
  DOM.studioFrame.style.transform = `scale(${stScale.toFixed(4)})`;

  // Apply master 3D camera transform
  setTransform(DOM.cameraRig, cam.x, cam.y, cam.scale, cam.rx, cam.ry, cam.rz);

  // Top-left Step Pill
  if (currentSlot && currentSlot.callout) {
    DOM.stepPill.style.opacity = String(smoothstep(0.15, 0.55, t).toFixed(3));
    DOM.stepText.textContent = currentSlot.callout;
  }

  // Virtual Cursor + Ripples
  if (cursor.visible) {
    DOM.cursor.style.opacity = '1';
    DOM.cursor.style.transform = `translate3d(${cursor.x.toFixed(1)}px, ${cursor.y.toFixed(1)}px, 0) scale(${cursor.scale.toFixed(3)})`;
    if (cursor.clickDt >= 0 && cursor.clickDt < 0.85) {
      renderRipples(cursor.x, cursor.y, cursor.clickDt);
    }
  } else {
    DOM.cursor.style.opacity = '0';
  }

  // Bilibili Bottom-Safe Kinetic Subtitles
  if (activeLine && activeLine.subtitle) {
    const fadeIn = smoothstep(activeLine.startSec - 0.08, activeLine.startSec + 0.14, t);
    const fadeOut = 1 - smoothstep(activeLine.endSec + 0.02, activeLine.endSec + 0.25, t);
    const op = fadeIn * fadeOut;
    DOM.subtitleBox.style.opacity = String(op.toFixed(3));
    DOM.subtitleBox.style.transform = `translate3d(0, ${lerp(12, 0, fadeIn).toFixed(1)}px, 0)`;
    DOM.subtitleText.textContent = activeLine.subtitle;
    const prog = clamp((t - activeLine.startSec) / activeLine.durationSec, 0, 1);
    DOM.subtitleProgress.style.width = `${(prog * 100).toFixed(2)}%`;

    const bars = DOM.subtitleEq.children;
    for (let i = 0; i < bars.length; i++) {
      const wave = 0.35 + 0.65 * Math.abs(Math.sin(t * (9.5 + i * 2.7) + i * 1.3));
      const h = Math.round(5 + wave * (10 + en.rms * 14));
      bars[i].style.height = `${h}px`;
    }
  } else {
    DOM.subtitleBox.style.opacity = '0';
  }

  // Audio-reactive bottom hairline spectrum
  DOM.bottomSpectrum.style.opacity = String((0.32 + en.rms * 0.55 + en.beat * 0.25).toFixed(3));
  DOM.bottomSpectrum.style.transform = `scaleX(${(0.55 + en.rms * 0.45 + en.beat * 0.12).toFixed(3)})`;

  // Final 2.2s smooth obsidian fade-out synced to BGM outro fade
  const fadeStart = STATE.totalDurationSec - 2.2;
  const fadeOp = smoothstep(fadeStart, STATE.totalDurationSec - 0.08, t);
  DOM.outroFade.style.opacity = String(fadeOp.toFixed(4));

  // Render Hardware WebGL2 Optical Prism Backdrop
  STATE.webgl.render({
    time: t,
    rms: en.rms,
    bass: en.bass,
    treble: en.treble,
    beat: en.beat,
    burst,
    sweep,
    lightMode,
    accent,
    camX: cam.x / 960,
    camY: -cam.y / 540,
    zoom: cam.scale,
  });

  // Ensure layout & WebGL compositing flush cleanly before screenshot capture
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function fetchJsonSafe(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function waitForIframes(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hWin = getHubWin();
    const sDoc = getStudioDoc();
    const hubReady = Boolean(hWin?.__agyPrism);
    const studioReady = Boolean(sDoc?.getElementById('prism-tabs-bar') && sDoc.querySelector('[data-action="card-click"]'));
    if (hubReady && studioReady) return { hubReady, studioReady };
    await new Promise((r) => setTimeout(r, 80));
  }
  return {
    hubReady: Boolean(getHubWin()?.__agyPrism),
    studioReady: Boolean(getStudioDoc()?.getElementById('prism-tabs-bar')),
  };
}

async function bootScene() {
  buildShatterShards();
  STATE.webgl = new PrismWebGL(DOM.webglCanvas);
  STATE.ambientCtx = DOM.ambientCanvas.getContext('2d');

  const [tlJson, scriptJson, energyJson, libJson, honkaiMeta] = await Promise.all([
    fetchJsonSafe('/audio/timeline.json'),
    fetchJsonSafe('/docs/narration-script.json'),
    fetchJsonSafe('/audio/bgm-energy.json'),
    fetchJsonSafe('/api/library'),
    fetchJsonSafe('/media/honkai3-frames/manifest.json').then((m) => m || fetchJsonSafe('/media/honkai3-meta.json')),
  ]);

  const norm = normalizeTimeline(tlJson, scriptJson);
  STATE.timeline = tlJson;
  STATE.energy = energyJson;
  STATE.shots = norm.shots;
  STATE.totalDurationSec = norm.totalDurationSec;
  STATE.shotMap = new Map(norm.shots.map((s) => [s.action, s]));

  const items = Array.isArray(libJson?.items) ? libJson.items : (Array.isArray(libJson) ? libJson : []);
  STATE.library = items;
  STATE.heroItem = items.find((x) => String(x.id).includes('2876797752') || String(x.title || '').includes('崩坏')) || items[0] || null;
  STATE.altItem = items.find((x) => x.id !== STATE.heroItem?.id && (x.kind === 'image' || x.kind === 'video')) || items[1] || STATE.heroItem;

  const bootCfg = window.__BOOT_CONFIG || {};
  STATE.honkai = new HonkaiFramePlayer({
    baseUrl: bootCfg.honkaiFramesUrl || honkaiMeta?.urlPrefix || '/media/honkai3-frames',
    startIndex: Number(honkaiMeta?.startIndex ?? bootCfg.honkaiStartIndex ?? 0),
    totalFrames: Number(bootCfg.honkaiFrameCount || honkaiMeta?.frameCount || honkaiMeta?.totalFrames || 721),
    fps: Number(bootCfg.honkaiFps || honkaiMeta?.fps || 60),
    fallbackPoster: '/media/honkai3-poster.png',
  });

  const iframeStatus = await waitForIframes();
  // Cleanly separate CTX 18% pill from Swarm status badge in Hub header so zero overlap occurs
  const hubDoc = getHubDoc();
  const ctxMeter = hubDoc?.getElementById('ag-context-meter');
  if (ctxMeter) ctxMeter.style.right = '296px';

  await STATE.honkai.ensurePoster();
  STATE.ready = true;
  await renderFrameAt(0);

  return {
    ready: true,
    webglMode: STATE.webgl.mode,
    webglRenderer: STATE.webgl.renderer,
    totalDurationSec: STATE.totalDurationSec,
    shotCount: STATE.shots.length,
    libraryCount: STATE.library.length,
    heroId: STATE.heroItem?.id || null,
    altId: STATE.altItem?.id || null,
    honkaiFrameCount: STATE.honkai.totalFrames,
    iframeStatus,
  };
}

window.__setTime = renderFrameAt;
window.__bootPromise = bootScene();
window.__getSceneInfo = () => ({
  ready: STATE.ready,
  webglMode: STATE.webgl?.mode,
  webglRenderer: STATE.webgl?.renderer,
  totalDurationSec: STATE.totalDurationSec,
  shotCount: STATE.shots.length,
  libraryCount: STATE.library.length,
});
