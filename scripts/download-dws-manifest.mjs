#!/usr/bin/env zx

/**
 * Fetch pinned dws release assets and write resources/dws/manifest.json.
 * GitHub 不可达或 API 403 时自动回退 Gitee；也可 DWS_GITEE_REPO 强制 Gitee。
 * Run: pnpm run dws:manifest
 */
import 'zx/globals';
import {
  DEFAULT_GITHUB_REPO,
  DEFAULT_GITEE_REPO,
  SKILLS_ZIP_ASSET_NAME,
  buildManifestFromRelease,
  enrichManifestGithubFallbackChecksums,
  fetchGithubRelease,
  fetchGiteeRelease,
  getConfiguredGiteeRepo,
  getGiteeFallbackRepo,
  isGiteeAssetUrl,
  normalizeDwsVersion,
  resolveActiveGiteeRepo,
} from '../shared/dws-release-resolver.mjs';

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'resources', 'dws', 'manifest.json');
const DEFAULT_VERSION = process.env.DWS_VERSION || '1.0.50';

async function defaultFetch(url, init = {}) {
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const version = normalizeDwsVersion(DEFAULT_VERSION);
const githubRepo = DEFAULT_GITHUB_REPO;
const giteeRepo = resolveActiveGiteeRepo(null);
let source = 'gitee';

echo(chalk.cyan(`Fetching dws v${version} via ${source} (github=${githubRepo}, gitee=${giteeRepo})...`));

let release;
try {
  release = await fetchGiteeRelease(giteeRepo, version, defaultFetch);
} catch (error) {
  if (getConfiguredGiteeRepo() || process.env.DWS_NO_FALLBACK === '1') throw error;
  echo(chalk.yellow(`Gitee fetch failed (${error.message}), falling back to GitHub API...`));
  source = 'github';
  release = await fetchGithubRelease(githubRepo, version, defaultFetch);
}

const manifest = buildManifestFromRelease({
  version,
  release,
  source,
  githubRepo,
  giteeRepo,
});

if (source === 'gitee') {
  await enrichManifestGithubFallbackChecksums(manifest, githubRepo, version, defaultFetch);
}

for (const spec of Object.values(manifest.platforms)) {
  if (isGiteeAssetUrl(spec.url) && spec.sha256) {
    echo(chalk.yellow`⚠️  Cleared sha256 for Gitee asset ${spec.assetName}; use githubSha256 on GitHub fallback only.`);
    spec.sha256 = null;
  }
  if (!spec.sha256 && !spec.githubSha256) {
    echo(chalk.yellow(`⚠️  No sha256 digest for ${spec.assetName}; Gitee install will skip checksum verification.`));
  }
}

if (!manifest.skillsZip?.sha256 && !manifest.skillsZip?.githubSha256) {
  echo(chalk.yellow(`⚠️  No sha256 digest for ${SKILLS_ZIP_ASSET_NAME}; Gitee install will skip checksum verification.`));
}

await fs.ensureDir(path.dirname(OUTPUT_PATH));
await fs.writeJson(OUTPUT_PATH, manifest, { spaces: 2 });
echo(chalk.green(`✓ Wrote ${OUTPUT_PATH} (source=${manifest.resolvedFrom})`));
