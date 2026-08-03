/**
 * dws release 下载源解析（GitHub / Gitee），与官方 scripts/install.sh 行为对齐。
 */

export const DEFAULT_GITHUB_REPO = 'DingTalk-Real-AI/dingtalk-workspace-cli';
export const DEFAULT_GITEE_REPO = 'DingTalk-Real-AI/dingtalk-workspace-cli';
export const SKILLS_ZIP_ASSET_NAME = 'dws-skills.zip';

export const DWS_PLATFORM_ASSETS = {
  'darwin-arm64': { assetName: 'dws-darwin-arm64.tar.gz', archive: 'tar.gz' as const },
  'darwin-x64': { assetName: 'dws-darwin-amd64.tar.gz', archive: 'tar.gz' as const },
  'win32-x64': { assetName: 'dws-windows-amd64.zip', archive: 'zip' as const },
  'win32-arm64': { assetName: 'dws-windows-arm64.zip', archive: 'zip' as const },
  'linux-x64': { assetName: 'dws-linux-amd64.tar.gz', archive: 'tar.gz' as const },
  'linux-arm64': { assetName: 'dws-linux-arm64.tar.gz', archive: 'tar.gz' as const },
};

export type DwsDownloadSource = 'cdn' | 'github' | 'gitee';

export type DwsDownloadSourcePriority = DwsDownloadSource;

export interface DwsReleaseSources {
  github?: { repo?: string };
  gitee?: { repo?: string };
}

export interface DwsPlatformAssetSpec {
  assetName?: string;
  url?: string;
  sha256?: string | null;
  /** GitHub 回退下载时的校验值；Gitee URL 不应使用 sha256 字段校验。 */
  githubSha256?: string | null;
  archive?: 'tar.gz' | 'zip';
  size?: number;
}

export interface DwsManifestLike {
  dwsVersion: string;
  sources?: DwsReleaseSources;
  platforms: Record<string, DwsPlatformAssetSpec>;
  skillsZip?: {
    assetName?: string;
    url?: string | null;
    sha256?: string | null;
    githubSha256?: string | null;
  } | null;
  releaseUrl?: string | null;
}

type FetchFn = (url: string, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>;

export function normalizeDwsVersionTag(version: string): string {
  const trimmed = String(version).trim().replace(/^v+/i, '');
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

export function getGithubRepo(manifest?: DwsManifestLike | null): string {
  return manifest?.sources?.github?.repo || DEFAULT_GITHUB_REPO;
}

export function getConfiguredGiteeRepo(): string | null {
  const explicit = process.env.DWS_GITEE_REPO?.trim();
  return explicit || null;
}

export function getGiteeFallbackRepo(manifest?: DwsManifestLike | null): string {
  return manifest?.sources?.gitee?.repo
    || process.env.DWS_GITEE_FALLBACK_REPO?.trim()
    || DEFAULT_GITEE_REPO;
}

export function buildGithubDirectAssetUrl(githubRepo: string, version: string, assetName: string): string {
  const tag = normalizeDwsVersionTag(version);
  return `https://github.com/${githubRepo}/releases/download/${tag}/${assetName}`;
}

export function inferAssetName(platformSpec?: DwsPlatformAssetSpec | null): string | null {
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

function pickAssetFromGiteeRelease(
  assets: Array<{ name?: string; browser_download_url?: string; size?: number }>,
  assetName: string,
) {
  const asset = assets.find((item) => item.name === assetName);
  if (!asset?.browser_download_url) throw new Error(`Gitee asset not found: ${assetName}`);
  return {
    url: asset.browser_download_url,
    sha256: null as string | null,
    size: asset.size,
  };
}

export async function probeGithubReachable(
  fetchFn: FetchFn,
  githubRepo = DEFAULT_GITHUB_REPO,
): Promise<boolean> {
  const probeUrl = `https://github.com/${githubRepo}/releases/latest`;
  try {
    const response = await fetchFn(probeUrl, {
      method: 'GET',
      redirect: 'follow',
      timeoutMs: 30_000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isDirectHttpUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

function defaultSourcePriority(): DwsDownloadSourcePriority[] {
  if (getConfiguredGiteeRepo()) return ['cdn', 'gitee', 'github'];
  if (process.env.DWS_NO_FALLBACK === '1') return ['cdn', 'gitee'];
  return ['cdn', 'gitee', 'github'];
}

export async function pickDownloadSource(options: {
  manifest?: DwsManifestLike | null;
  fetchFn: FetchFn;
  githubRepo?: string;
  sourcePriority?: DwsDownloadSourcePriority[];
  platformSpec?: DwsPlatformAssetSpec | null;
}): Promise<DwsDownloadSource> {
  void options.fetchFn;
  void options.githubRepo;
  void options.manifest;
  const priority = options.sourcePriority?.length
    ? options.sourcePriority
    : defaultSourcePriority();
  for (const source of priority) {
    if (source === 'cdn' && isDirectHttpUrl(options.platformSpec?.url)) return 'cdn';
    if (source === 'gitee') return 'gitee';
    if (source === 'github') return 'github';
  }
  return priority[0] ?? 'gitee';
}

export function resolveActiveGiteeRepo(manifest?: DwsManifestLike | null): string {
  return getConfiguredGiteeRepo() || getGiteeFallbackRepo(manifest);
}

export async function fetchGiteeRelease(
  giteeRepo: string,
  version: string,
  fetchFn: FetchFn,
): Promise<{ assets?: Array<{ name?: string; browser_download_url?: string; size?: number }> }> {
  const tag = normalizeDwsVersionTag(version);
  const tagUrl = `https://gitee.com/api/v5/repos/${giteeRepo}/releases/tags/${tag}`;
  const tagResponse = await fetchFn(tagUrl, { timeoutMs: 120_000 });
  if (tagResponse.ok) {
    const release = await tagResponse.json() as Record<string, unknown> | null;
    if (release && typeof release === 'object' && !Array.isArray(release)) {
      return release as { assets?: Array<{ name?: string; browser_download_url?: string; size?: number }> };
    }
  }

  const listUrl = `https://gitee.com/api/v5/repos/${giteeRepo}/releases`;
  const listResponse = await fetchFn(listUrl, { timeoutMs: 120_000 });
  if (!listResponse.ok) {
    throw new Error(`Gitee releases list HTTP ${listResponse.status} for ${listUrl}`);
  }
  const releases = await listResponse.json() as Array<{ tag_name?: string; name?: string; assets?: Array<{ name?: string; browser_download_url?: string; size?: number }> }>;
  if (!Array.isArray(releases)) {
    throw new Error(`Gitee releases list invalid for ${giteeRepo}`);
  }
  const matched = releases.find((item) => item.tag_name === tag || item.name === tag);
  if (!matched) {
    throw new Error(`Gitee release not found: ${tag} (mirror may not include this version yet)`);
  }
  return matched;
}

export async function resolveGiteeAssetUrl(
  giteeRepo: string,
  version: string,
  assetName: string,
  fetchFn: FetchFn,
): Promise<string> {
  const release = await fetchGiteeRelease(giteeRepo, version, fetchFn);
  return pickAssetFromGiteeRelease(release.assets || [], assetName).url;
}

export async function resolveAssetDownloadUrl(options: {
  source: DwsDownloadSource;
  manifest?: DwsManifestLike | null;
  version: string;
  assetName: string;
  platformSpec?: DwsPlatformAssetSpec | null;
  fetchFn: FetchFn;
}): Promise<{ url: string; source: DwsDownloadSource; giteeRepo?: string; githubRepo?: string }> {
  const githubRepo = getGithubRepo(options.manifest);
  const giteeRepo = resolveActiveGiteeRepo(options.manifest);

  if (options.source === 'cdn') {
    const url = options.platformSpec?.url;
    if (!isDirectHttpUrl(url)) {
      throw new Error(`CDN asset URL missing for ${options.assetName}`);
    }
    return { url, source: 'cdn' };
  }

  if (options.source === 'gitee') {
    const url = await resolveGiteeAssetUrl(giteeRepo, options.version, options.assetName, options.fetchFn);
    return { url, source: 'gitee', giteeRepo };
  }

  const url = options.platformSpec?.url
    || buildGithubDirectAssetUrl(githubRepo, options.version, options.assetName);
  return { url, source: 'github', githubRepo };
}

export function isGiteeAssetUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes('gitee.com');
  } catch {
    return false;
  }
}

export interface DwsAssetChecksumSpec {
  sha256?: string | null;
  githubSha256?: string | null;
}

/** Gitee 镜像包体与 GitHub 可能不一致，仅对 GitHub URL 做 sha256 校验。 */
export function resolveSha256ForDownloadUrl(
  url: string,
  assetSpec?: DwsAssetChecksumSpec | null,
): string | null {
  if (!assetSpec || isGiteeAssetUrl(url)) return null;
  return assetSpec.githubSha256 ?? assetSpec.sha256 ?? null;
}

export async function resolveAssetDownloadUrlWithFallback(options: {
  manifest?: DwsManifestLike | null;
  version: string;
  assetName: string;
  platformSpec?: DwsPlatformAssetSpec | null;
  fetchFn: FetchFn;
  sourcePriority?: DwsDownloadSourcePriority[];
}): Promise<{
  url: string;
  source: DwsDownloadSource;
  giteeRepo?: string;
  githubRepo?: string;
  fallbackFrom?: DwsDownloadSource;
}> {
  const priority = options.sourcePriority?.length
    ? options.sourcePriority
    : defaultSourcePriority();
  const primary = await pickDownloadSource({
    manifest: options.manifest,
    fetchFn: options.fetchFn,
    githubRepo: getGithubRepo(options.manifest),
    sourcePriority: priority,
    platformSpec: options.platformSpec,
  });

  try {
    return await resolveAssetDownloadUrl({
      source: primary,
      manifest: options.manifest,
      version: options.version,
      assetName: options.assetName,
      platformSpec: options.platformSpec,
      fetchFn: options.fetchFn,
    });
  } catch (primaryError) {
    if (primary === 'cdn') {
      const withoutCdn = priority.filter((item) => item !== 'cdn');
      if (withoutCdn.length === 0) throw primaryError;
      return resolveAssetDownloadUrlWithFallback({
        ...options,
        sourcePriority: withoutCdn,
      });
    }
    if (primary !== 'gitee' || process.env.DWS_NO_FALLBACK === '1') throw primaryError;
    const githubRepo = getGithubRepo(options.manifest);
    const url = options.platformSpec?.url
      || buildGithubDirectAssetUrl(githubRepo, options.version, options.assetName);
    return { url, source: 'github', githubRepo, fallbackFrom: 'gitee' };
  }
}
