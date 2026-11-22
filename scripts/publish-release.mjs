#!/usr/bin/env node
/**
 * Publish `out/agy-wallpaper-prism-intro.mp4` and Bilibili covers to GitHub Releases.
 *
 * Authentication (in order, never hardcoded or logged):
 *   1. process.env.GITHUB_TOKEN or process.env.GH_TOKEN
 *   2. Standard `git credential fill` for https://github.com/<owner>/<repo>.git
 *
 * Usage:
 *   node scripts/publish-release.mjs
 *   node scripts/publish-release.mjs --tag v1.0.0 --repo azwosile/agy-wallpaper-prism-intro
 *   node scripts/publish-release.mjs --dry-run
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    tag: 'v1.0.0',
    repo: 'azwosile/agy-wallpaper-prism-intro',
    target: 'main',
    title: 'Wallpaper Prism v1.1.0 — Bilibili Promo Video & Covers (v1.0.0)',
    dryRun: false,
    notesFile: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tag' && argv[i + 1]) opts.tag = argv[++i];
    else if (a === '--repo' && argv[i + 1]) opts.repo = argv[++i];
    else if (a === '--target' && argv[i + 1]) opts.target = argv[++i];
    else if (a === '--title' && argv[i + 1]) opts.title = argv[++i];
    else if (a === '--notes-file' && argv[i + 1]) opts.notesFile = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/publish-release.mjs [--tag v1.0.0] [--repo owner/repo] [--target main] [--title "..."] [--notes-file path] [--dry-run]',
      );
      process.exit(0);
    }
  }
  return opts;
}

function resolveGitHubToken(repoSlug) {
  const envToken = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (envToken) return { token: envToken, source: 'env' };

  try {
    const input = `protocol=https\nhost=github.com\npath=${repoSlug}.git\n\n`;
    const stdout = execFileSync('git', ['credential', 'fill'], {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 8000,
    });
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('password=')) {
        const value = line.slice('password='.length).trim();
        if (value) return { token: value, source: 'git-credential' };
      }
    }
  } catch {
    // Credential helper unavailable or non-interactive.
  }

  return { token: '', source: 'none' };
}

function buildDefaultReleaseNotes(assets) {
  const lines = [
    '## Wallpaper Prism (`agy-wallpaper-prism` v1.1.0) — Bilibili 宣传片与封面发布包',
    '',
    '- **Plugin Repository**: https://github.com/azwosile/agy-wallpaper-prism',
    '- **Publishing Guide**: [`docs/bilibili-publish-guide.md`](https://github.com/azwosile/agy-wallpaper-prism-intro/blob/main/docs/bilibili-publish-guide.md)',
    '',
    '### Included Assets · 包含资产',
    ...assets.map((a) => {
      const sizeMB = (a.size / (1024 * 1024)).toFixed(2);
      return `- \`${a.name}\` (${sizeMB} MB, \`${a.contentType}\`)`;
    }),
    '',
    '### Highlights',
    '- `1920×1080 @ 60fps` (`93.80s` / `5,628` frames), `H.264 High@4.2` (`yuv420p`, `bt709`, `+faststart`) + `48kHz` AAC-LC stereo (`194kbps`, `-13.9 LUFS`, `-2.1 dBFS` true peak).',
    '- Authentic Mambo (`曼波`) voiceover synced with hardware WebGL2 Obsidian Prism optics and real sanitized Antigravity Hub / Wallpaper Prism Studio captures.',
    '- Dedicated `16:9` (`1920×1080`) and `4:3` (`1600×1200`) high-contrast Bilibili PNG covers.',
  ];
  return lines.join('\n');
}

function collectAssets() {
  const specs = [
    { rel: 'out/agy-wallpaper-prism-intro.mp4', contentType: 'video/mp4', required: true },
    { rel: 'covers/cover-16x9.png', contentType: 'image/png', required: true },
    { rel: 'covers/cover-4x3.png', contentType: 'image/png', required: true },
  ];
  const assets = [];
  for (const spec of specs) {
    const absPath = path.join(REPO_ROOT, spec.rel);
    if (!fs.existsSync(absPath)) {
      if (spec.required) {
        throw new Error(`Missing required release asset: ${spec.rel}`);
      }
      continue;
    }
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Release asset is empty or invalid: ${spec.rel}`);
    }
    assets.push({
      name: path.basename(absPath),
      absPath,
      rel: spec.rel,
      size: stat.size,
      contentType: spec.contentType,
    });
  }
  return assets;
}

async function ghFetch(url, token, options = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'agy-wallpaper-prism-intro-publisher/1.0',
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [owner, repo] = opts.repo.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid --repo value "${opts.repo}". Expected "owner/repo".`);
  }

  const assets = collectAssets();
  const releaseBody = opts.notesFile
    ? fs.readFileSync(path.resolve(REPO_ROOT, opts.notesFile), 'utf8')
    : buildDefaultReleaseNotes(assets);

  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          repo: opts.repo,
          tag: opts.tag,
          target: opts.target,
          title: opts.title,
          assets: assets.map((a) => ({ name: a.name, sizeBytes: a.size, contentType: a.contentType })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const { token, source } = resolveGitHubToken(opts.repo);
  if (!token) {
    console.error(
      [
        'GitHub API authentication token not found in GITHUB_TOKEN, GH_TOKEN, or git credential store.',
        'Run one of the following to publish Release ' + opts.tag + ':',
        '  $env:GITHUB_TOKEN = "<your-github-pat-with-repo-scope>"',
        '  node scripts/publish-release.mjs --tag ' + opts.tag,
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log(`Authenticated via ${source} for ${opts.repo} (tag ${opts.tag}).`);

  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const getRes = await ghFetch(`${apiBase}/releases/tags/${encodeURIComponent(opts.tag)}`, token);

  let release;
  if (getRes.ok && getRes.json?.id) {
    console.log(`Found existing release ${opts.tag} (id=${getRes.json.id}); updating metadata...`);
    const patchRes = await ghFetch(`${apiBase}/releases/${getRes.json.id}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: opts.title,
        body: releaseBody,
        draft: false,
        prerelease: false,
      }),
    });
    if (!patchRes.ok) {
      throw new Error(`Failed to update release (${patchRes.status}): ${patchRes.json?.message || patchRes.text}`);
    }
    release = patchRes.json;
  } else if (getRes.status === 404) {
    console.log(`Creating release ${opts.tag} on ${opts.repo}...`);
    const createRes = await ghFetch(`${apiBase}/releases`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: opts.tag,
        target_commitish: opts.target,
        name: opts.title,
        body: releaseBody,
        draft: false,
        prerelease: false,
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create release (${createRes.status}): ${createRes.json?.message || createRes.text}`);
    }
    release = createRes.json;
  } else {
    throw new Error(`Failed to query release (${getRes.status}): ${getRes.json?.message || getRes.text}`);
  }

  const existingAssets = Array.isArray(release.assets) ? release.assets : [];
  const uploaded = [];

  for (const asset of assets) {
    const dup = existingAssets.find((item) => item.name === asset.name);
    if (dup) {
      console.log(`Replacing existing asset ${asset.name} (id=${dup.id})...`);
      const delRes = await ghFetch(`${apiBase}/releases/assets/${dup.id}`, token, { method: 'DELETE' });
      if (!delRes.ok && delRes.status !== 404) {
        throw new Error(`Failed to delete old asset ${asset.name} (${delRes.status})`);
      }
    }

    const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`;
    const buf = fs.readFileSync(asset.absPath);
    console.log(`Uploading ${asset.name} (${(asset.size / (1024 * 1024)).toFixed(2)} MB)...`);
    const upRes = await ghFetch(uploadUrl, token, {
      method: 'POST',
      headers: {
        'Content-Type': asset.contentType,
        'Content-Length': String(buf.length),
      },
      body: buf,
    });
    if (!upRes.ok) {
      throw new Error(`Failed to upload ${asset.name} (${upRes.status}): ${upRes.json?.message || upRes.text}`);
    }
    uploaded.push({
      name: upRes.json.name,
      sizeBytes: upRes.json.size,
      downloadUrl: upRes.json.browser_download_url,
    });
  }

  console.log(
    JSON.stringify(
      {
        status: 'published',
        repo: opts.repo,
        tag: release.tag_name,
        releaseUrl: release.html_url,
        assets: uploaded,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(`publish-release error: ${err.message}`);
  process.exit(1);
});
