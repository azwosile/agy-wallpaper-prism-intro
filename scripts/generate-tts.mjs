#!/usr/bin/env node
/**
 * generate-tts.mjs
 *
 * Synthesizes every narration line in `docs/narration-script.json` into
 * `audio/vo/<id>.mp3` using Fish Audio `s2.1-pro-free` and the verified
 * Mambo (曼波) voice model, trims leading/trailing dead silence cleanly,
 * verifies every file via ffprobe/ffmpeg, and writes exact millisecond
 * timestamps to `audio/timeline.json`.
 *
 * SECURITY: Reads `process.env.FISH_API_KEY` only. Never hardcode or log API keys.
 *
 * Usage:
 *   FISH_API_KEY=... node scripts/generate-tts.mjs [--fetch-only | --finalize] [--force] [--only id1,id2] [--speed 1.08]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SCRIPT_PATH = join(PROJECT_ROOT, 'docs', 'narration-script.json');
const VO_DIR = join(PROJECT_ROOT, 'audio', 'vo');
const TIMELINE_PATH = join(PROJECT_ROOT, 'audio', 'timeline.json');

// Verified authentic 曼波 (Mambo) Mandarin voice model on Fish Audio (ranked #1 by task_count: 71,257)
const DEFAULT_REFERENCE_ID = '0f08cacd3e354471a4b94dd00b4cc4a3';
const DEFAULT_TTS_MODEL = 's2.1-pro-free';
const DEFAULT_SPEED = 1.08;
const VIDEO_FPS = 60;

function parseArgs(argv) {
  const opts = {
    fetchOnly: false,
    finalizeOnly: false,
    force: false,
    only: null,
    referenceId: process.env.FISH_REFERENCE_ID || DEFAULT_REFERENCE_ID,
    model: process.env.FISH_TTS_MODEL || DEFAULT_TTS_MODEL,
    speed: DEFAULT_SPEED,
    skipTrim: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fetch-only') opts.fetchOnly = true;
    else if (a === '--finalize') opts.finalizeOnly = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--skip-trim') opts.skipTrim = true;
    else if (a === '--only' && argv[i + 1]) opts.only = new Set(argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--reference-id' && argv[i + 1]) opts.referenceId = argv[++i];
    else if (a === '--model' && argv[i + 1]) opts.model = argv[++i];
    else if (a === '--speed' && argv[i + 1]) opts.speed = Number(argv[++i]);
  }
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ffprobeJson(filePath) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  return JSON.parse(out);
}

function detectVolume(filePath) {
  const res = spawnSync('ffmpeg', ['-v', 'info', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const stderr = res.stderr || '';
  const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  const maxMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
  return {
    meanVolumeDb: meanMatch ? Number(meanMatch[1]) : null,
    maxVolumeDb: maxMatch ? Number(maxMatch[1]) : null,
  };
}

async function synthesizeLine(apiKey, { text, referenceId, model, speed }) {
  const url = 'https://api.fish.audio/v1/tts';
  const payload = {
    text,
    reference_id: referenceId,
    format: 'mp3',
    mp3_bitrate: 192,
    normalize: true,
    prosody: {
      speed,
      volume: 0.0,
    },
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          model,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const msg = `Fish Audio HTTP ${res.status}: ${errText.slice(0, 300)}`;
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
          const waitMs = 1000 * Math.pow(2, attempt);
          console.warn(`  [retry ${attempt}/3] ${msg} — waiting ${waitMs}ms...`);
          await sleep(waitMs);
          continue;
        }
        throw new Error(msg);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) {
        throw new Error(`Received suspiciously small audio payload (${buf.length} bytes)`);
      }
      return buf;
    } catch (err) {
      lastErr = err;
      if (attempt < 4 && !/HTTP 40[0134]/.test(err.message)) {
        const waitMs = 1000 * attempt;
        console.warn(`  [retry ${attempt}/3] ${err.message} — waiting ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function fetchAllLines(script, opts) {
  const apiKey = process.env.FISH_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      'FISH_API_KEY environment variable is required for TTS synthesis. ' +
      'Set FISH_API_KEY in your shell environment before running scripts/generate-tts.mjs.'
    );
  }

  mkdirSync(VO_DIR, { recursive: true });
  const lines = script.lines || [];
  console.log(`[generate-tts] Synthesizing ${lines.length} lines via Fish Audio (${opts.model}, ref=${opts.referenceId}, speed=${opts.speed})...`);

  let generated = 0;
  let skipped = 0;
  for (const line of lines) {
    if (opts.only && !opts.only.has(line.id)) continue;
    const outPath = join(VO_DIR, `${line.id}.mp3`);
    if (existsSync(outPath) && !opts.force) {
      skipped++;
      console.log(`  [skip] ${line.id}.mp3 already exists (pass --force to overwrite)`);
      continue;
    }
    const lineSpeed = typeof line.speed === 'number' ? line.speed : opts.speed;
    const t0 = Date.now();
    const buf = await synthesizeLine(apiKey.trim(), {
      text: line.text,
      referenceId: opts.referenceId,
      model: opts.model,
      speed: lineSpeed,
    });
    writeFileSync(outPath, buf);
    const ms = Date.now() - t0;
    generated++;
    console.log(`  [ok] ${line.id}.mp3 (${buf.length} bytes, ${ms}ms)`);
    await sleep(220);
  }
  console.log(`[generate-tts] Fetch complete: ${generated} synthesized, ${skipped} skipped.`);
}

function trimAndNormalizeClip(mp3Path) {
  const beforeProbe = ffprobeJson(mp3Path);
  const beforeStream = (beforeProbe.streams || []).find((s) => s.codec_type === 'audio');
  if (!beforeStream) {
    throw new Error(`No valid audio stream in ${mp3Path}`);
  }
  const beforeDur = Number(beforeProbe.format.duration || beforeStream.duration || 0);
  if (!Number.isFinite(beforeDur) || beforeDur <= 0.1) {
    throw new Error(`Invalid duration (${beforeDur}s) in ${mp3Path}`);
  }

  const tmpPath = `${mp3Path}.trim.mp3`;
  // Gently remove leading/trailing dead silence (<-42dB) while keeping 25ms head & 50ms tail
  // and level per-clip loudness to -16 LUFS so all 15 lines sit evenly in the final mix.
  const af = [
    'silenceremove=start_periods=1:start_silence=0.025:start_threshold=-42dB',
    'areverse',
    'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-42dB',
    'areverse',
    'loudnorm=I=-16:TP=-1.5:LRA=8',
  ].join(',');

  const res = spawnSync(
    'ffmpeg',
    [
      '-v', 'error',
      '-y',
      '-i', mp3Path,
      '-af', af,
      '-ar', '48000',
      '-ac', '1',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      tmpPath,
    ],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  if (res.status !== 0) {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    throw new Error(`ffmpeg trim failed on ${mp3Path}: ${(res.stderr || '').slice(-400)}`);
  }

  const afterProbe = ffprobeJson(tmpPath);
  const afterDur = Number(afterProbe.format.duration || 0);
  // Sanity check: never accept an over-trimmed clip
  if (!Number.isFinite(afterDur) || afterDur < 0.35 || afterDur < beforeDur * 0.45) {
    unlinkSync(tmpPath);
    console.warn(`  [warn] Skipping trim on ${mp3Path} (before=${beforeDur.toFixed(3)}s, after=${afterDur.toFixed(3)}s)`);
    return beforeDur;
  }

  renameSync(tmpPath, mp3Path);
  return afterDur;
}

function finalizeTimeline(script, opts) {
  const lines = script.lines || [];
  if (lines.length === 0) {
    throw new Error('narration-script.json contains no lines.');
  }

  console.log(`[generate-tts] Verifying${opts.skipTrim ? '' : ' & trimming'} ${lines.length} VO clips...`);

  const measured = [];
  for (const line of lines) {
    const mp3Path = join(VO_DIR, `${line.id}.mp3`);
    if (!existsSync(mp3Path)) {
      throw new Error(`Missing synthesized VO clip: ${mp3Path}`);
    }
    const rawProbe = ffprobeJson(mp3Path);
    const rawDur = Number(rawProbe.format.duration || 0);
    if (!opts.skipTrim) {
      trimAndNormalizeClip(mp3Path);
    }
    const finalProbe = ffprobeJson(mp3Path);
    const audioStream = (finalProbe.streams || []).find((s) => s.codec_type === 'audio');
    if (!audioStream) {
      throw new Error(`Corrupt audio stream in ${mp3Path}`);
    }
    const durationSec = Number(finalProbe.format.duration || audioStream.duration);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error(`Zero/invalid duration in ${mp3Path}`);
    }
    const vol = detectVolume(mp3Path);
    if (vol.meanVolumeDb !== null && vol.meanVolumeDb < -55) {
      throw new Error(`Clip ${line.id} appears silent (mean=${vol.meanVolumeDb} dB)`);
    }
    measured.push({
      line,
      rawDurationSec: Math.round(rawDur * 1000) / 1000,
      durationSec: Math.round(durationSec * 1000) / 1000,
      sampleRate: Number(audioStream.sample_rate),
      channels: audioStream.channels,
      meanVolumeDb: vol.meanVolumeDb,
      maxVolumeDb: vol.maxVolumeDb,
    });
  }

  // Schedule exact millisecond timestamps:
  // Respect beat-aligned targetStartSec whenever prior speech + minimum breathing pause clears it,
  // and guarantee zero overlaps with crisp Bilibili pacing.
  const timelineLines = [];
  let cursorSec = 0;

  for (let i = 0; i < measured.length; i++) {
    const item = measured[i];
    const { line, durationSec } = item;
    const targetStart = Number(line.targetStartSec ?? cursorSec);
    const pauseAfter = Number(line.pauseAfterSec ?? 0.35);

    let startSec;
    if (i === 0) {
      startSec = Math.max(0.25, targetStart);
    } else {
      const prev = timelineLines[i - 1];
      const prevPause = Number(prev.pauseAfterSec ?? 0.35);
      // Allow breathing room to compress slightly (down to 0.22s) inside same act if needed to catch the beat anchor
      const minGap = prev.act === line.act ? Math.min(prevPause, 0.22) : Math.min(prevPause, 0.28);
      const preferredStart = prev.endSec + prevPause;
      const earliestStart = prev.endSec + minGap;
      if (targetStart >= preferredStart) {
        startSec = targetStart;
      } else if (targetStart >= earliestStart) {
        startSec = targetStart;
      } else {
        startSec = earliestStart;
      }
    }

    startSec = Math.round(startSec * 1000) / 1000;
    const endSec = Math.round((startSec + durationSec) * 1000) / 1000;
    const startMs = Math.round(startSec * 1000);
    const endMs = Math.round(endSec * 1000);
    const durationMs = endMs - startMs;
    const startFrame = Math.round(startSec * VIDEO_FPS);
    const endFrame = Math.round(endSec * VIDEO_FPS);
    const driftSec = Math.round((startSec - targetStart) * 1000) / 1000;

    timelineLines.push({
      id: line.id,
      act: line.act ?? 1,
      scene: line.scene,
      startSec,
      endSec,
      durationSec,
      startMs,
      endMs,
      durationMs,
      startFrame,
      endFrame,
      targetStartSec: targetStart,
      driftFromTargetSec: driftSec,
      pauseAfterSec: pauseAfter,
      text: line.text,
      subtitle: line.subtitle,
      callout: line.callout,
      action: line.action,
      audioFile: `audio/vo/${line.id}.mp3`,
      meanVolumeDb: item.meanVolumeDb,
      maxVolumeDb: item.maxVolumeDb,
    });

    cursorSec = endSec + pauseAfter;
    console.log(
      `  [${line.id}] ${startSec.toFixed(3)}s -> ${endSec.toFixed(3)}s (dur=${durationSec.toFixed(3)}s, raw=${item.rawDurationSec.toFixed(3)}s, drift=${driftSec >= 0 ? '+' : ''}${driftSec.toFixed(3)}s, mean=${item.meanVolumeDb}dB)`
    );
  }

  const last = timelineLines[timelineLines.length - 1];
  const outroFadeSec = Number(script.meta?.outroFadeSec ?? 2.5);
  const tailPad = Math.max(outroFadeSec, Number(last.pauseAfterSec ?? 2.5));
  const computedTotal = Math.round((last.endSec + tailPad) * 1000) / 1000;
  // Ensure totalDurationSec is at least targetDurationSec if within 2s, otherwise exact speech + outro tail
  const targetTotal = Number(script.meta?.targetDurationSec || 0);
  const totalDurationSec =
    targetTotal > computedTotal && targetTotal - computedTotal <= 3.0
      ? targetTotal
      : computedTotal;
  const totalFrames = Math.ceil(totalDurationSec * VIDEO_FPS);

  // Build act boundaries for motion choreography
  const actMap = new Map();
  for (const l of timelineLines) {
    if (!actMap.has(l.act)) {
      actMap.set(l.act, { act: l.act, startSec: l.startSec, endSec: l.endSec, lineIds: [l.id] });
    } else {
      const a = actMap.get(l.act);
      a.endSec = l.endSec;
      a.lineIds.push(l.id);
    }
  }
  const acts = Array.from(actMap.values()).map((a, idx, arr) => {
    const startSec = idx === 0 ? 0 : a.startSec;
    const endSec = idx === arr.length - 1 ? totalDurationSec : arr[idx + 1].startSec;
    return {
      act: a.act,
      startSec: Math.round(startSec * 1000) / 1000,
      endSec: Math.round(endSec * 1000) / 1000,
      startFrame: Math.round(startSec * VIDEO_FPS),
      endFrame: Math.round(endSec * VIDEO_FPS),
      lineIds: a.lineIds,
    };
  });

  const timeline = {
    meta: {
      ...(script.meta || {}),
      ttsProvider: 'fish.audio',
      ttsModel: opts.model,
      referenceId: opts.referenceId,
      voiceName: '曼波',
      masterMixWav: 'audio/master-mix.wav',
      masterMixAac: 'audio/master-mix.aac',
      bgmEnergyFile: 'audio/bgm-energy.json',
      generatedAt: new Date().toISOString(),
    },
    fps: VIDEO_FPS,
    totalDurationSec,
    totalFrames,
    lineCount: timelineLines.length,
    acts,
    lines: timelineLines,
  };

  writeFileSync(TIMELINE_PATH, JSON.stringify(timeline, null, 2) + '\n', 'utf8');
  console.log(
    `\n[generate-tts] Wrote audio/timeline.json (${timelineLines.length} lines, totalDurationSec=${totalDurationSec}s, totalFrames=${totalFrames}@${VIDEO_FPS}fps).`
  );
  return timeline;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`Narration script not found: ${SCRIPT_PATH}`);
  }
  const script = JSON.parse(readFileSync(SCRIPT_PATH, 'utf8'));

  if (!opts.finalizeOnly) {
    await fetchAllLines(script, opts);
  }
  if (!opts.fetchOnly) {
    finalizeTimeline(script, opts);
  }
}

main().catch((err) => {
  console.error('[generate-tts] ERROR:', err.message);
  process.exit(1);
});
