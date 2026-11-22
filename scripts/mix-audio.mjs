#!/usr/bin/env node
/**
 * mix-audio.mjs
 *
 * 1) Extracts 60fps normalized audio energy envelopes (rms, bass, treble, peak, beats)
 *    from the BGM track into `audio/bgm-energy.json` for WebGL2 visual reactivity.
 * 2) Mixes voiceover clips (`audio/vo/*.mp3`) at exact millisecond offsets from
 *    `audio/timeline.json` over the BGM with smooth sidechain ducking, intro/outro
 *    fades, and 2-pass EBU R128 mastering to -14 LUFS (Bilibili standard).
 * 3) Outputs `audio/master-mix.wav` and `audio/master-mix.aac` (192kbps, 48kHz, stereo)
 *    and verifies duration and loudness via ffprobe / ffmpeg.
 *
 * Usage:
 *   node scripts/mix-audio.mjs --energy-only [--bgm-start 0] [--duration 0]
 *   node scripts/mix-audio.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const DEFAULT_BGM_REL = 'audio/残像音阶,M3mo - 感官过载.mp3';
const TIMELINE_PATH = join(PROJECT_ROOT, 'audio', 'timeline.json');
const ENERGY_PATH = join(PROJECT_ROOT, 'audio', 'bgm-energy.json');
const MASTER_WAV_PATH = join(PROJECT_ROOT, 'audio', 'master-mix.wav');
const MASTER_AAC_PATH = join(PROJECT_ROOT, 'audio', 'master-mix.aac');

const SAMPLE_RATE = 48000;
const ENERGY_FPS = 60;
const SAMPLES_PER_FRAME = SAMPLE_RATE / ENERGY_FPS; // 800 exact samples/frame

function parseArgs(argv) {
  const opts = {
    energyOnly: false,
    bgmStartSec: null,
    durationSec: null,
    bgmRel: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--energy-only') opts.energyOnly = true;
    else if (a === '--bgm-start' && argv[i + 1]) opts.bgmStartSec = Number(argv[++i]);
    else if (a === '--duration' && argv[i + 1]) opts.durationSec = Number(argv[++i]);
    else if (a === '--bgm' && argv[i + 1]) opts.bgmRel = argv[++i];
  }
  return opts;
}

export function ffprobeJson(filePath) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  return JSON.parse(out);
}

function decodeBandFloat32(bgmAbsPath, filterExpr, startSec = 0, durationSec = null) {
  const args = ['-v', 'error'];
  if (startSec > 0) args.push('-ss', startSec.toFixed(4));
  args.push('-i', bgmAbsPath);
  if (durationSec && durationSec > 0) args.push('-t', durationSec.toFixed(4));
  if (filterExpr) args.push('-af', filterExpr);
  args.push('-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1');

  const buf = execFileSync('ffmpeg', args, {
    maxBuffer: 128 * 1024 * 1024,
  });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

function computeFrameEnvelopes(samples, totalFrames) {
  const rms = new Float64Array(totalFrames);
  const peak = new Float64Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    const start = f * SAMPLES_PER_FRAME;
    const end = Math.min(start + SAMPLES_PER_FRAME, samples.length);
    if (start >= samples.length) break;
    let sumSq = 0;
    let maxAbs = 0;
    const count = end - start;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      sumSq += v * v;
      const av = v < 0 ? -v : v;
      if (av > maxAbs) maxAbs = av;
    }
    rms[f] = count > 0 ? Math.sqrt(sumSq / count) : 0;
    peak[f] = maxAbs;
  }
  return { rms, peak };
}

function normalizeArray(arr, percentile = 0.992) {
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * percentile)));
  const ref = sorted[idx] > 1e-6 ? sorted[idx] : 1;
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = Math.min(1, Math.max(0, arr[i] / ref));
    out[i] = Math.round(v * 10000) / 10000;
  }
  return out;
}

function detectBeats(bassNorm, rmsNorm, fps) {
  // Simple spectral flux / onset detection on normalized bass + RMS
  const beats = [];
  const minGapFrames = Math.round(fps * 0.28); // max ~214 BPM
  let lastBeat = -minGapFrames;
  const win = Math.round(fps * 0.5); // 0.5s moving average window
  for (let i = 2; i < bassNorm.length - 1; i++) {
    let sum = 0;
    let cnt = 0;
    const w0 = Math.max(0, i - win);
    for (let j = w0; j < i; j++) {
      sum += bassNorm[j];
      cnt++;
    }
    const localAvg = cnt > 0 ? sum / cnt : 0;
    const flux = bassNorm[i] - bassNorm[i - 1];
    const isLocalMax = bassNorm[i] >= bassNorm[i - 1] && bassNorm[i] >= bassNorm[i + 1];
    if (
      isLocalMax &&
      i - lastBeat >= minGapFrames &&
      bassNorm[i] > Math.max(0.45, localAvg * 1.28) &&
      flux > 0.045 &&
      rmsNorm[i] > 0.25
    ) {
      beats.push(Math.round((i / fps) * 1000) / 1000);
      lastBeat = i;
    }
  }
  return beats;
}

export function extractBgmEnergy({ bgmRel = DEFAULT_BGM_REL, bgmStartSec = 0, durationSec = null } = {}) {
  const bgmAbs = resolve(PROJECT_ROOT, bgmRel);
  if (!existsSync(bgmAbs)) {
    throw new Error(`BGM file not found: ${bgmAbs}`);
  }
  const probe = ffprobeJson(bgmAbs);
  const fullDuration = Number(probe.format.duration);
  const effectiveDuration =
    durationSec && durationSec > 0 ? Math.min(durationSec, Math.max(0.1, fullDuration - bgmStartSec)) : Math.max(0.1, fullDuration - bgmStartSec);
  const totalFrames = Math.ceil(effectiveDuration * ENERGY_FPS);

  const fullSamples = decodeBandFloat32(bgmAbs, null, bgmStartSec, effectiveDuration);
  const bassSamples = decodeBandFloat32(bgmAbs, 'lowpass=f=180:p=2', bgmStartSec, effectiveDuration);
  const trebleSamples = decodeBandFloat32(bgmAbs, 'highpass=f=2500:p=2', bgmStartSec, effectiveDuration);

  const fullEnv = computeFrameEnvelopes(fullSamples, totalFrames);
  const bassEnv = computeFrameEnvelopes(bassSamples, totalFrames);
  const trebleEnv = computeFrameEnvelopes(trebleSamples, totalFrames);

  const rms = normalizeArray(fullEnv.rms, 0.99);
  const peak = normalizeArray(fullEnv.peak, 0.995);
  const bass = normalizeArray(bassEnv.rms, 0.985);
  const treble = normalizeArray(trebleEnv.rms, 0.985);
  const beats = detectBeats(bass, rms, ENERGY_FPS);

  // Also compute 1-second energy summary buckets (handy for pacing inspection)
  const secCount = Math.ceil(effectiveDuration);
  const energyBySecond = [];
  for (let s = 0; s < secCount; s++) {
    const f0 = s * ENERGY_FPS;
    const f1 = Math.min(totalFrames, (s + 1) * ENERGY_FPS);
    let rSum = 0;
    let bSum = 0;
    let tSum = 0;
    const n = Math.max(1, f1 - f0);
    for (let f = f0; f < f1; f++) {
      rSum += rms[f];
      bSum += bass[f];
      tSum += treble[f];
    }
    energyBySecond.push({
      sec: s,
      bgmSec: Math.round((bgmStartSec + s) * 100) / 100,
      rms: Math.round((rSum / n) * 1000) / 1000,
      bass: Math.round((bSum / n) * 1000) / 1000,
      treble: Math.round((tSum / n) * 1000) / 1000,
    });
  }

  const result = {
    source: bgmRel.replace(/\\/g, '/'),
    bgmStartSec: Math.round(bgmStartSec * 1000) / 1000,
    fps: ENERGY_FPS,
    durationSec: Math.round(effectiveDuration * 1000) / 1000,
    totalFrames,
    beatCount: beats.length,
    beats,
    rms,
    bass,
    treble,
    peak,
    energyBySecond,
  };

  mkdirSync(dirname(ENERGY_PATH), { recursive: true });
  writeFileSync(ENERGY_PATH, JSON.stringify(result));
  return result;
}

function measureLoudnorm(inputPath, targetI = -14, targetTP = -1.5, targetLRA = 9) {
  let stderr = '';
  try {
    execFileSync(
      'ffmpeg',
      [
        '-v', 'info',
        '-i', inputPath,
        '-af', `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${targetLRA}:print_format=json`,
        '-f', 'null',
        '-',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    );
  } catch (err) {
    stderr = err.stderr ? String(err.stderr) : '';
    throw new Error(`loudnorm measure failed: ${stderr.slice(-500)}`);
  }
  // ffmpeg prints loudnorm JSON to stderr even on exit 0; capture via spawnSync or 2>&1
  return stderr;
}

function runFfmpegCaptureStderr(args) {
  // Use spawnSync to reliably capture both exit code and stderr
  return import('node:child_process').then(({ spawnSync }) => {
    const res = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (res.status !== 0) {
      throw new Error(`ffmpeg exited ${res.status}:\n${(res.stderr || '').slice(-1500)}`);
    }
    return res.stderr || '';
  });
}

function extractLoudnormJson(stderrText) {
  const matches = stderrText.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/g);
  if (!matches || matches.length === 0) {
    throw new Error(`Could not find loudnorm JSON in ffmpeg output:\n${stderrText.slice(-800)}`);
  }
  return JSON.parse(matches[matches.length - 1]);
}

function extractVolumeDetect(stderrText) {
  const meanMatch = stderrText.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  const maxMatch = stderrText.match(/max_volume:\s*([-\d.]+)\s*dB/);
  return {
    meanVolumeDb: meanMatch ? Number(meanMatch[1]) : null,
    maxVolumeDb: maxMatch ? Number(maxMatch[1]) : null,
  };
}

async function mixMaster() {
  if (!existsSync(TIMELINE_PATH)) {
    throw new Error(`Timeline file not found: ${TIMELINE_PATH}. Run generate-tts.mjs first.`);
  }
  const timeline = JSON.parse(readFileSync(TIMELINE_PATH, 'utf8'));
  const bgmRel = timeline.meta?.bgmFile || DEFAULT_BGM_REL;
  const bgmAbs = resolve(PROJECT_ROOT, bgmRel);
  if (!existsSync(bgmAbs)) {
    throw new Error(`BGM file not found: ${bgmAbs}`);
  }

  const bgmStartSec = Number(timeline.meta?.bgmStartSec || 0);
  const totalDurationSec = Number(timeline.totalDurationSec);
  if (!totalDurationSec || totalDurationSec <= 0) {
    throw new Error(`Invalid totalDurationSec in timeline.json: ${totalDurationSec}`);
  }

  const lines = timeline.lines || [];
  if (lines.length === 0) {
    throw new Error('timeline.json contains no narration lines.');
  }

  // Verify every VO file exists
  const voInputs = lines.map((line) => {
    const rel = line.audioFile || `audio/vo/${line.id}.mp3`;
    const abs = resolve(PROJECT_ROOT, rel);
    if (!existsSync(abs)) {
      throw new Error(`Missing VO clip for ${line.id}: ${abs}`);
    }
    return { ...line, absPath: abs };
  });

  // Build ffmpeg inputs: input 0 is BGM (trimmed from bgmStartSec), inputs 1..N are VO clips
  const bgmProbe = ffprobeJson(bgmAbs);
  const bgmFullDur = Number(bgmProbe.format.duration);
  const needsLoop = bgmStartSec + totalDurationSec > bgmFullDur - 0.1;

  const inputArgs = ['-v', 'error', '-y'];
  if (needsLoop) {
    inputArgs.push('-stream_loop', '-1');
  }
  if (bgmStartSec > 0) {
    inputArgs.push('-ss', bgmStartSec.toFixed(4));
  }
  inputArgs.push('-t', totalDurationSec.toFixed(4), '-i', bgmAbs);

  for (const clip of voInputs) {
    inputArgs.push('-i', clip.absPath);
  }

  // Build filter_complex:
  // - Voiceover bus: each clip resampled to 48kHz stereo, gentle voice EQ/cleanup, delayed to exact startMs
  // - Sum VO clips with amix (normalize=0) + pad to totalDurationSec
  // - Voice presence compression & gentle peak guard
  // - BGM: 48kHz stereo, base volume 0.56, fade-in 0.6s, fade-out 2.5s
  // - Sidechain duck BGM using VO bus so speech is crystal-clear while BGM punches hard in intro/gaps/outro
  const filters = [];
  const voLabels = [];

  for (let i = 0; i < voInputs.length; i++) {
    const clip = voInputs[i];
    const inIdx = i + 1;
    const delayMs = Math.max(0, Math.round(clip.startSec * 1000));
    const lbl = `v${i}`;
    voLabels.push(`[${lbl}]`);
    filters.push(
      `[${inIdx}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `highpass=f=85,equalizer=f=3200:t=q:w=1.2:g=1.8,` +
      `adelay=${delayMs}|${delayMs}[${lbl}]`
    );
  }

  filters.push(
    `${voLabels.join('')}amix=inputs=${voLabels.length}:duration=longest:dropout_transition=0:normalize=0,` +
    `apad=whole_dur=${totalDurationSec.toFixed(4)},atrim=0:${totalDurationSec.toFixed(4)},` +
    `acompressor=threshold=-18dB:ratio=2.6:attack=8:release=110:makeup=2.2dB,` +
    `alimiter=limit=0.92:attack=3:release=40,` +
    `volume=1.18,asplit=2[vo_main][vo_sc]`
  );

  const fadeOutDur = Math.min(2.5, Math.max(1.0, totalDurationSec * 0.1));
  const fadeOutStart = Math.max(0, totalDurationSec - fadeOutDur);

  filters.push(
    `[0:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
    `atrim=0:${totalDurationSec.toFixed(4)},asetpts=PTS-STARTPTS,` +
    `volume=0.56,` +
    `afade=t=in:st=0:d=0.65:curve=qsin,` +
    `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)}:curve=qsin[bgm_bed]`
  );

  // Sidechain ducking: when Mambo speaks, BGM smoothly dips ~9-11 dB; swells right back in gaps
  filters.push(
    `[bgm_bed][vo_sc]sidechaincompress=threshold=0.022:ratio=5.2:attack=18:release=260:knee=4:makeup=1:level_in=1:level_sc=2.2[bgm_ducked]`
  );

  filters.push(
    `[bgm_ducked][vo_main]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,` +
    `atrim=0:${totalDurationSec.toFixed(4)},asetpts=PTS-STARTPTS[pre_master]`
  );

  const preMasterPath = join(PROJECT_ROOT, 'audio', 'master-premix.wav');
  const filterComplex = filters.join(';\n');

  console.log(`[mix-audio] Mixing ${voInputs.length} VO clips + BGM (${bgmStartSec}s -> +${totalDurationSec.toFixed(3)}s)...`);
  await runFfmpegCaptureStderr([
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[pre_master]',
    '-c:a', 'pcm_f32le',
    '-ar', String(SAMPLE_RATE),
    '-ac', '2',
    preMasterPath,
  ]);

  // Pass 1: EBU R128 loudnorm analysis targeting -14 LUFS, -1.5 dBTP, LRA 9 (Bilibili broadcast target)
  console.log('[mix-audio] Running 2-pass EBU R128 loudness normalization (-14 LUFS, -1.5 dBTP)...');
  const pass1Stderr = await runFfmpegCaptureStderr([
    '-v', 'info',
    '-i', preMasterPath,
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json',
    '-f', 'null',
    '-',
  ]);
  const measured = extractLoudnormJson(pass1Stderr);
  console.log(`[mix-audio] Pre-master measured: I=${measured.input_i} LUFS, TP=${measured.input_tp} dBTP, LRA=${measured.input_lra} LU`);

  const loudnormPass2 =
    `loudnorm=I=-14:TP=-1.5:LRA=9:` +
    `measured_I=${measured.input_i}:` +
    `measured_TP=${measured.input_tp}:` +
    `measured_LRA=${measured.input_lra}:` +
    `measured_thresh=${measured.input_thresh}:` +
    `offset=${measured.target_offset}:linear=true:print_format=summary`;

  // Pass 2: Render final master-mix.wav (16-bit PCM 48kHz stereo)
  await runFfmpegCaptureStderr([
    '-v', 'info',
    '-y',
    '-i', preMasterPath,
    '-af', loudnormPass2,
    '-c:a', 'pcm_s16le',
    '-ar', String(SAMPLE_RATE),
    '-ac', '2',
    MASTER_WAV_PATH,
  ]);

  // Encode master-mix.aac (192kbps, 48kHz, stereo)
  await runFfmpegCaptureStderr([
    '-v', 'error',
    '-y',
    '-i', MASTER_WAV_PATH,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', String(SAMPLE_RATE),
    '-ac', '2',
    '-movflags', '+faststart',
    MASTER_AAC_PATH,
  ]);

  // Remove temporary pre-mix file cleanly
  const { unlinkSync } = await import('node:fs');
  if (existsSync(preMasterPath)) unlinkSync(preMasterPath);

  // Verify final outputs via ffprobe + loudnorm + volumedetect
  const wavProbe = ffprobeJson(MASTER_WAV_PATH);
  const aacProbe = ffprobeJson(MASTER_AAC_PATH);

  const verifyStderr = await runFfmpegCaptureStderr([
    '-v', 'info',
    '-i', MASTER_WAV_PATH,
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json,volumedetect',
    '-f', 'null',
    '-',
  ]);
  const finalLoud = extractLoudnormJson(verifyStderr);
  const finalVol = extractVolumeDetect(verifyStderr);

  // Regenerate video-aligned bgm-energy.json starting at exact bgmStartSec for totalDurationSec
  console.log(`[mix-audio] Updating video-aligned audio/bgm-energy.json (bgmStartSec=${bgmStartSec}, dur=${totalDurationSec.toFixed(3)}s)...`);
  const energy = extractBgmEnergy({ bgmRel, bgmStartSec, durationSec: totalDurationSec });

  const report = {
    wav: {
      path: 'audio/master-mix.wav',
      durationSec: Number(wavProbe.format.duration),
      sampleRate: Number(wavProbe.streams[0].sample_rate),
      channels: wavProbe.streams[0].channels,
      sizeBytes: Number(wavProbe.format.size),
    },
    aac: {
      path: 'audio/master-mix.aac',
      durationSec: Number(aacProbe.format.duration),
      sampleRate: Number(aacProbe.streams[0].sample_rate),
      channels: aacProbe.streams[0].channels,
      bitRate: Number(aacProbe.streams[0].bit_rate || aacProbe.format.bit_rate),
      sizeBytes: Number(aacProbe.format.size),
    },
    loudness: {
      integratedLufs: Number(finalLoud.input_i),
      truePeakDbtp: Number(finalLoud.input_tp),
      lraLu: Number(finalLoud.input_lra),
      meanVolumeDb: finalVol.meanVolumeDb,
      maxVolumeDb: finalVol.maxVolumeDb,
    },
    bgmEnergy: {
      path: 'audio/bgm-energy.json',
      bgmStartSec: energy.bgmStartSec,
      fps: energy.fps,
      totalFrames: energy.totalFrames,
      beatCount: energy.beatCount,
    },
  };

  console.log('[mix-audio] DONE! Verification report:');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.energyOnly) {
    const res = extractBgmEnergy({
      bgmRel: opts.bgmRel || DEFAULT_BGM_REL,
      bgmStartSec: opts.bgmStartSec || 0,
      durationSec: opts.durationSec || null,
    });
    console.log(
      JSON.stringify(
        {
          path: 'audio/bgm-energy.json',
          source: res.source,
          bgmStartSec: res.bgmStartSec,
          fps: res.fps,
          durationSec: res.durationSec,
          totalFrames: res.totalFrames,
          beatCount: res.beatCount,
          first10Beats: res.beats.slice(0, 10),
        },
        null,
        2
      )
    );
  } else {
    mixMaster().catch((err) => {
      console.error('[mix-audio] ERROR:', err.message);
      process.exit(1);
    });
  }
}
