/**
 * dws release 下载源解析（GitHub / Gitee），与官方 scripts/install.sh 行为对齐。
 * 构建期（download-dws-manifest.mjs）与运行时（dws-cli.ts）共用。
 */

export const DEFAULT_GITHUB_REPO = 'DingTalk-Real-AI/dingtalk-workspace-cli';
export const DEFAULT_GITEE_REPO = 'DingTalk-Real-AI/dingtalk-workspace-cli';
export const SKILLS_ZIP_ASSET_NAME = 'dws-skills.zip';

export const DWS_PLATFORM_ASSETS = {
  'darwin-arm64': { assetName: 'dws-darwin-arm64.tar.gz', archive: 'tar.gz' },
  'darwin-x64': { assetName: 'dws-darwin-amd64.tar.gz', archive: 'tar.gz' },
  'win32-x64': { assetName: 'dws-windows-amd64.zip', archive: 'zip' },
  'win32-arm64': { assetName: 'dws-windows-arm64.zip', archive: 'zip' },
  'linux-x64': { assetName: 'dws-linux-amd64.tar.gz', archive: 'tar.gz' },
  'linux-arm64': { assetName: 'dws-linux-arm64.tar.gz', archive: 'tar.gz' },
};

export function normalizeDwsVersionTag(version) {
  const trimmed = String(version).trim().replace(/^v+/i, '');
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

export function normalizeDwsVersion(version) {
  return String(version).trim().replace(/^v+/i, '');
}

export function getGithubRepo(manifest) {
  return manifest?.sources?.github?.repo || DEFAULT_GITHUB_REPO;
}

export function getConfiguredGiteeRepo() {
  const explicit = process.env.DWS_GITEE_REPO?.trim();
  if (explicit) return explicit;
  return null;
}

export function getGiteeFallbackRepo(manifest) {
  return manifest?.sources?.gitee?.repo
    || process.env.DWS_GITEE_FALLBACK_REPO?.trim()
    || DEFAULT_GITEE_REPO;
}

export function buildGithubDirectAssetUrl(githubRepo, version, assetName) {
  const tag = normalizeDwsVersionTag(version);
  return `https://github.com/${githubRepo}/releases/download/${tag}/${assetName}`;
}

export function inferAssetName(platformSpec) {
  if (platformSpec?.assetName) return platformSpec.assetName;
  if (platformSpec?.url) {
    try {
      return new URL(platformSpec.url).pathname.split('/').pop() || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function pickAssetFromGithubRelease(assets, assetName) {
  const asset = assets.find((item) => item.name === assetName);
  if (!asset) {
    throw new Error(`GitHub asset not found: ${assetName}`);
  }
  const digest = asset.digest || '';
  const sha256 = digest.startsWith('sha256:') ? digest.slice(7) : null;
  return {
    url: asset.browser_download_url,
    sha256,
    size: asset.size,
  };
}

export function pickAssetFromGiteeRelease(assets, assetName) {
  const asset = assets.find((item) => item.name === assetName);
  if (!asset?.browser_download_url) {
    throw new Error(`Gitee asset not found: ${assetName}`);
  }
  return {
    url: asset.browser_download_url,
    sha256: null,
    size: asset.size,
  };
}

async function fetchJson(url, fetchFn, init = {}) {
  const response = await fetchFn(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'sto-claw-dws-release-resolver',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

export async function probeGithubReachable(fetchFn, githubRepo = DEFAULT_GITHUB_REPO) {
  const probeUrl = `https://github.com/${githubRepo}/releases/latest`;
  try {
    const response = await fetchFn(probeUrl, {
      method: 'GET',
      redirect: 'follow',
      timeoutMs: 12_000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * StoClaw 默认 Gitee 优先；DWS_GITEE_REPO 显式指定时同样走 Gitee。
 * DWS_NO_FALLBACK=1 时仅用 Gitee，不回退 GitHub。
 * @returns {'github' | 'gitee'}
 */
export async function pickDownloadSource({ manifest, fetchFn, githubRepo = DEFAULT_GITHUB_REPO } = {}) {
  void fetchFn;
  void githubRepo;
  void manifest;
  if (getConfiguredGiteeRepo()) return 'gitee';
  if (process.env.DWS_NO_FALLBACK === '1') return 'gitee';
  return 'gitee';
}

export function resolveActiveGiteeRepo(manifest) {
  return getConfiguredGiteeRepo() || getGiteeFallbackRepo(manifest);
}

export async function fetchGithubRelease(githubRepo, version, fetchFn) {
  const tag = normalizeDwsVersionTag(version);
  const url = `https://api.github.com/repos/${githubRepo}/releases/tags/${tag}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sto-claw-dws-manifest',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetchJson(url, fetchFn, { headers, timeoutMs: 60_000 });
}

export async function fetchGiteeRelease(giteeRepo, version, fetchFn) {
  const tag = normalizeDwsVersionTag(version);
  const tagUrl = `https://gitee.com/api/v5/repos/${giteeRepo}/releases/tags/${tag}`;
  const tagResponse = await fetchFn(tagUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'sto-claw-dws-release-resolver',
    },
    timeoutMs: 60_000,
  });
  if (tagResponse.ok) {
    const release = await tagResponse.json();
    if (release && typeof release === 'object' && !Array.isArray(release)) {
      return release;
    }
  }

  const listUrl = `https://gitee.com/api/v5/repos/${giteeRepo}/releases`;
  const listResponse = await fetchFn(listUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'sto-claw-dws-release-resolver',
    },
    timeoutMs: 60_000,
  });
  if (!listResponse.ok) {
    throw new Error(`Gitee releases list HTTP ${listResponse.status} for ${listUrl}`);
  }
  const releases = await listResponse.json();
  if (!Array.isArray(releases)) {
    throw new Error(`Gitee releases list invalid for ${giteeRepo}`);
  }
  const matched = releases.find((item) => item.tag_name === tag || item.name === tag);
  if (!matched) {
    throw new Error(`Gitee release not found: ${tag} (mirror may not include this version yet)`);
  }
  return matched;
}

export async function resolveGiteeAssetUrl(giteeRepo, version, assetName, fetchFn) {
  const release = await fetchGiteeRelease(giteeRepo, version, fetchFn);
  const picked = pickAssetFromGiteeRelease(release.assets || [], assetName);
  return picked.url;
}

export async function resolveAssetDownloadUrl({
  source,
  manifest,
  version,
  assetName,
  platformSpec,
  fetchFn,
}) {
  const githubRepo = getGithubRepo(manifest);
  const giteeRepo = resolveActiveGiteeRepo(manifest);

  if (source === 'gitee') {
    const url = await resolveGiteeAssetUrl(giteeRepo, version, assetName, fetchFn);
    return { url, source: 'gitee', giteeRepo };
  }

  const url = platformSpec?.url || buildGithubDirectAssetUrl(githubRepo, version, assetName);
  return { url, source: 'github', githubRepo };
}

export async function resolveAssetDownloadUrlWithFallback({
  manifest,
  version,
  assetName,
  platformSpec,
  fetchFn,
}) {
  let source = await pickDownloadSource({ manifest, fetchFn, githubRepo: getGithubRepo(manifest) });
  try {
    return await resolveAssetDownloadUrl({
      source,
      manifest,
      version,
      assetName,
      platformSpec,
      fetchFn,
    });
  } catch (primaryError) {
    if (source !== 'gitee' || process.env.DWS_NO_FALLBACK === '1') throw primaryError;
    const githubRepo = getGithubRepo(manifest);
    const url = platformSpec?.url || buildGithubDirectAssetUrl(githubRepo, version, assetName);
    return { url, source: 'github', githubRepo, fallbackFrom: 'gitee' };
  }
}

export function isGiteeAssetUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().includes('gitee.com');
  } catch {
    return false;
  }
}

/** Gitee 镜像包体与 GitHub 可能不一致，仅对 GitHub URL 做 sha256 校验。 */
export function resolveSha256ForDownloadUrl(url, assetSpec) {
  if (!assetSpec || isGiteeAssetUrl(url)) return null;
  return assetSpec.githubSha256 ?? assetSpec.sha256 ?? null;
}

export async function enrichManifestGithubFallbackChecksums(manifest, githubRepo, version, fetchFn) {
  try {
    const release = await fetchGithubRelease(githubRepo, version, fetchFn);
    const assets = release.assets || [];
    for (const spec of Object.values(manifest.platforms)) {
      try {
        const picked = pickAssetFromGithubRelease(assets, spec.assetName);
        if (picked.sha256) {
          spec.githubSha256 = picked.sha256;
        }
        if (isGiteeAssetUrl(spec.url)) {
          spec.sha256 = null;
        }
      } catch {
        // ignore per-platform
      }
    }
    if (manifest.skillsZip?.assetName) {
      try {
        const picked = pickAssetFromGithubRelease(assets, manifest.skillsZip.assetName);
        if (picked.sha256) {
          manifest.skillsZip.githubSha256 = picked.sha256;
        }
        if (manifest.skillsZip.url && isGiteeAssetUrl(manifest.skillsZip.url)) {
          manifest.skillsZip.sha256 = null;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // GitHub API 不可用时 Gitee 安装跳过 sha256
  }
}

/** @deprecated 使用 enrichManifestGithubFallbackChecksums */
export async function enrichManifestSha256FromGithub(manifest, githubRepo, version, fetchFn) {
  return enrichManifestGithubFallbackChecksums(manifest, githubRepo, version, fetchFn);
}

export function buildManifestFromRelease({
  version,
  release,
  source,
  githubRepo = DEFAULT_GITHUB_REPO,
  giteeRepo = DEFAULT_GITEE_REPO,
}) {
  const normalizedVersion = normalizeDwsVersion(version);
  const assets = release.assets || [];
  const platforms = {};

  for (const [platformKey, spec] of Object.entries(DWS_PLATFORM_ASSETS)) {
    const picked = source === 'gitee'
      ? pickAssetFromGiteeRelease(assets, spec.assetName)
      : pickAssetFromGithubRelease(assets, spec.assetName);
    platforms[platformKey] = {
      assetName: spec.assetName,
      url: picked.url,
      sha256: picked.sha256,
      archive: spec.archive,
      size: picked.size,
    };
  }

  let skillsZip;
  try {
    const picked = source === 'gitee'
      ? pickAssetFromGiteeRelease(assets, SKILLS_ZIP_ASSET_NAME)
      : pickAssetFromGithubRelease(assets, SKILLS_ZIP_ASSET_NAME);
    skillsZip = {
      assetName: SKILLS_ZIP_ASSET_NAME,
      url: picked.url,
      sha256: picked.sha256,
    };
  } catch {
    skillsZip = {
      assetName: SKILLS_ZIP_ASSET_NAME,
      url: source === 'gitee'
        ? null
        : buildGithubDirectAssetUrl(githubRepo, normalizedVersion, SKILLS_ZIP_ASSET_NAME),
      sha256: null,
    };
  }

  return {
    dwsVersion: normalizedVersion,
    skillMode: 'mono',
    skillsRevision: normalizedVersion,
    sources: {
      github: { repo: githubRepo },
      gitee: { repo: giteeRepo },
    },
    releaseUrl: release.html_url || release.url || null,
    resolvedFrom: source,
    platforms,
    skillsZip,
  };
}
