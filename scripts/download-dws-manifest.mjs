#!/usr/bin/env zx

/**
 * Fetch pinned dws release assets from GitHub and write resources/dws/manifest.json.
 * Run: pnpm run dws:manifest
 */
import 'zx/globals';
import { createHash } from 'node:crypto';

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'resources', 'dws', 'manifest.json');
const REPO = 'DingTalk-Real-AI/dingtalk-workspace-cli';
const DEFAULT_VERSION = process.env.DWS_VERSION || '1.0.32';

const PLATFORM_ASSETS = {
  'darwin-arm64': { assetName: 'dws-darwin-arm64.tar.gz', archive: 'tar.gz' },
  'darwin-x64': { assetName: 'dws-darwin-amd64.tar.gz', archive: 'tar.gz' },
  'win32-x64': { assetName: 'dws-windows-amd64.zip', archive: 'zip' },
  'win32-arm64': { assetName: 'dws-windows-arm64.zip', archive: 'zip' },
  'linux-x64': { assetName: 'dws-linux-amd64.tar.gz', archive: 'tar.gz' },
  'linux-arm64': { assetName: 'dws-linux-arm64.tar.gz', archive: 'tar.gz' },
};

async function fetchRelease(version) {
  const tag = version.startsWith('v') ? version : `v${version}`;
  const url = `https://api.github.com/repos/${REPO}/releases/tags/${tag}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sto-claw-dws-manifest' },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
  return response.json();
}

function pickAsset(assets, name) {
  const asset = assets.find((item) => item.name === name);
  if (!asset) {
    throw new Error(`Asset not found: ${name}`);
  }
  const digest = asset.digest || '';
  const sha256 = digest.startsWith('sha256:') ? digest.slice(7) : null;
  return {
    url: asset.browser_download_url,
    sha256,
    size: asset.size,
  };
}

const version = DEFAULT_VERSION.replace(/^v/, '');
echo(chalk.cyan`Fetching dws v${version} from ${REPO}...`);
const release = await fetchRelease(version);
const platforms = {};

for (const [platformKey, spec] of Object.entries(PLATFORM_ASSETS)) {
  const picked = pickAsset(release.assets, spec.assetName);
  platforms[platformKey] = {
    url: picked.url,
    sha256: picked.sha256,
    archive: spec.archive,
    size: picked.size,
  };
  if (!picked.sha256) {
    echo(chalk.yellow`⚠️  No sha256 digest for ${spec.assetName}; install will skip checksum verification.`);
  }
}

const manifest = {
  dwsVersion: version,
  skillMode: 'mono',
  skillsRevision: version,
  mirrorBaseUrl: null,
  releaseUrl: release.html_url,
  platforms,
};

await fs.ensureDir(path.dirname(OUTPUT_PATH));
await fs.writeJson(OUTPUT_PATH, manifest, { spaces: 2 });
echo(chalk.green`✓ Wrote ${OUTPUT_PATH}`);
