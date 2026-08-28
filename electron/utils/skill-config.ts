/**
 * Skill Config Utilities
 * Direct read/write access to skill configuration in ~/.stoclaw/openclaw/openclaw.json
 * This bypasses the Gateway RPC for faster and more reliable config updates.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { readFile, writeFile, access, cp, mkdir } from 'fs/promises';
import { existsSync, readFileSync, cpSync, rmSync, watch } from 'fs';
import { constants } from 'fs';
import { join } from 'path';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import { getOpenClawDir, getResourcesDir, getOpenClawConfigDir, ensureDir } from './paths';
import { logger } from './logger';
import { withConfigLock } from './config-mutex';

const OPENCLAW_CONFIG_PATH = join(getOpenClawConfigDir(), 'openclaw.json');

interface SkillEntry {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
}

interface OpenClawConfig {
    skills?: {
        entries?: Record<string, SkillEntry>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface PreinstalledSkillSpec {
    slug: string;
    version?: string;
    autoEnable?: boolean;
    local?: boolean;
}

interface PreinstalledManifest {
    skills?: PreinstalledSkillSpec[];
}

interface PreinstalledLockEntry {
    slug: string;
    version?: string;
}

interface PreinstalledLockFile {
    skills?: PreinstalledLockEntry[];
}

interface PreinstalledMarker {
    source: 'stoclaw-preinstalled';
    slug: string;
    version: string;
    installedAt: string;
}

async function fileExists(p: string): Promise<boolean> {
    try { await access(p, constants.F_OK); return true; } catch { return false; }
}

/**
 * Read the current OpenClaw config
 */
async function readConfig(): Promise<OpenClawConfig> {
    if (!(await fileExists(OPENCLAW_CONFIG_PATH))) {
        return {};
    }
    try {
        const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('Failed to read openclaw config:', err);
        return {};
    }
}

/**
 * Write the OpenClaw config
 */
async function writeConfig(config: OpenClawConfig): Promise<void> {
    const json = JSON.stringify(config, null, 2);
    await writeFile(OPENCLAW_CONFIG_PATH, json, 'utf-8');
}

export async function setSkillsEnabled(skillKeys: string[], enabled: boolean): Promise<void> {
    if (skillKeys.length === 0) {
        return;
    }
    return withConfigLock(async () => {
        const config = await readConfig();
        if (!config.skills) {
            config.skills = {};
        }
        if (!config.skills.entries) {
            config.skills.entries = {};
        }
        for (const skillKey of skillKeys) {
            const entry = config.skills.entries[skillKey] || {};
            entry.enabled = enabled;
            config.skills.entries[skillKey] = entry;
        }
        await writeConfig(config);
    });
}

/**
 * Get skill config
 */
export async function getSkillConfig(skillKey: string): Promise<SkillEntry | undefined> {
    const config = await readConfig();
    return config.skills?.entries?.[skillKey];
}

/**
 * Update skill config (apiKey and env)
 */
export async function updateSkillConfig(
    skillKey: string,
    updates: { apiKey?: string; env?: Record<string, string> }
): Promise<{ success: boolean; error?: string }> {
    try {
        return await withConfigLock(async () => {
            const config = await readConfig();

            // Ensure skills.entries exists
            if (!config.skills) {
                config.skills = {};
            }
            if (!config.skills.entries) {
                config.skills.entries = {};
            }

            // Get or create skill entry
            const entry = config.skills.entries[skillKey] || {};

            // Update apiKey
            if (updates.apiKey !== undefined) {
                const trimmed = updates.apiKey.trim();
                if (trimmed) {
                    entry.apiKey = trimmed;
                } else {
                    delete entry.apiKey;
                }
            }

            // Update env
            if (updates.env !== undefined) {
                const newEnv: Record<string, string> = {};

                for (const [key, value] of Object.entries(updates.env)) {
                    const trimmedKey = key.trim();
                    if (!trimmedKey) continue;

                    const trimmedVal = value.trim();
                    if (trimmedVal) {
                        newEnv[trimmedKey] = trimmedVal;
                    }
                }

                if (Object.keys(newEnv).length > 0) {
                    entry.env = newEnv;
                } else {
                    delete entry.env;
                }
            }

            // Save entry back
            config.skills.entries[skillKey] = entry;

            await writeConfig(config);
            return { success: true };
        });
    } catch (err) {
        console.error('Failed to update skill config:', err);
        return { success: false, error: String(err) };
    }
}

/**
 * Get all skill configs (for syncing to frontend)
 */
export async function getAllSkillConfigs(): Promise<Record<string, SkillEntry>> {
    const config = await readConfig();
    return config.skills?.entries || {};
}

/**
 * Built-in skills bundled with StoClaw that should be pre-deployed to
 * ~/.stoclaw/openclaw/skills/ on first launch.  These come from the openclaw package's
 * extensions directory and are available in both dev and packaged builds.
 */
const BUILTIN_SKILLS = [] as const;

/**
 * Ensure built-in skills are deployed to ~/.stoclaw/openclaw/skills/<slug>/.
 * Skips any skill that already has a SKILL.md present (idempotent).
 * Runs at app startup; all errors are logged and swallowed so they never
 * block the normal startup flow.
 */
export async function ensureBuiltinSkillsInstalled(): Promise<void> {
    const skillsRoot = join(getOpenClawConfigDir(), 'skills');

    for (const { slug, sourceExtension } of BUILTIN_SKILLS) {
        const targetDir = join(skillsRoot, slug);
        const targetManifest = join(targetDir, 'SKILL.md');

        if (existsSync(targetManifest)) {
            continue; // already installed
        }

        const openclawDir = getOpenClawDir();
        const sourceDir = join(openclawDir, 'extensions', sourceExtension, 'skills', slug);

        if (!existsSync(join(sourceDir, 'SKILL.md'))) {
            logger.warn(`Built-in skill source not found, skipping: ${sourceDir}`);
            continue;
        }

        try {
            await mkdir(targetDir, { recursive: true });
            await cp(sourceDir, targetDir, { recursive: true });        } catch (error) {
            logger.warn(`Failed to install built-in skill ${slug}:`, error);
        }
    }
}

const PREINSTALLED_MANIFEST_NAME = 'preinstalled-manifest.json';
const PREINSTALLED_MARKER_NAME = '.stoclaw-preinstalled.json';

function resolvePreinstalledManifestPath(): string | null {
    const candidates = [
        join(getResourcesDir(), 'skills', PREINSTALLED_MANIFEST_NAME),
        join(process.cwd(), 'resources', 'skills', PREINSTALLED_MANIFEST_NAME),
        join(__dirname, '../../resources/skills', PREINSTALLED_MANIFEST_NAME),
    ];
    return candidates.find((p) => existsSync(p)) || null;
}

/** Slugs declared in resources/skills/preinstalled-manifest.json (sync). */
export function readPreinstalledManifestSlugs(): Set<string> {
    const manifestPath = resolvePreinstalledManifestPath();
    if (!manifestPath) {
        return new Set();
    }
    try {
        const raw = readFileSync(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledManifest;
        if (!Array.isArray(parsed.skills)) {
            return new Set();
        }
        return new Set(
            parsed.skills
                .map((s) => s.slug?.trim())
                .filter((slug): slug is string => Boolean(slug)),
        );
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills manifest:', error);
        return new Set();
    }
}

async function readPreinstalledManifest(): Promise<PreinstalledSkillSpec[]> {
    const manifestPath = resolvePreinstalledManifestPath();
    if (!manifestPath) {
        return [];
    }

    try {
        const raw = await readFile(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledManifest;
        if (!Array.isArray(parsed.skills)) {
            return [];
        }
        return parsed.skills.filter((s): s is PreinstalledSkillSpec => Boolean(s?.slug));
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills manifest:', error);
        return [];
    }
}

function resolvePreinstalledSkillsSourceRoot(): string | null {
    const candidates = [
        join(getResourcesDir(), 'preinstalled-skills'),
        join(process.cwd(), 'build', 'preinstalled-skills'),
        join(__dirname, '../../build/preinstalled-skills'),
        // Dev fallback: local skills live directly under resources/skills/
        // when the bundle script hasn't generated build/preinstalled-skills yet.
        join(process.cwd(), 'resources', 'skills'),
        join(__dirname, '../../resources/skills'),
    ];

    const root = candidates.find((dir) => existsSync(dir));
    return root || null;
}

/**
 * In dev, local built-in skills are read live from resources/skills/<slug>/ so
 * edits take effect without re-running the preinstalled-skills bundle script.
 */
function resolveLiveLocalSkillSourceDir(slug: string): string | null {
    if (app.isPackaged) {
        return null;
    }

    const candidates = [
        join(getResourcesDir(), 'skills', slug),
        join(process.cwd(), 'resources', 'skills', slug),
        join(__dirname, '../../resources/skills', slug),
    ];

    for (const dir of candidates) {
        if (existsSync(join(dir, 'SKILL.md'))) {
            return dir;
        }
    }

    return null;
}

function resolveSkillSourceDir(spec: PreinstalledSkillSpec, bundledRoot: string): string {
    if (spec.local) {
        const liveSource = resolveLiveLocalSkillSourceDir(spec.slug);
        if (liveSource) {
            return liveSource;
        }
    }
    return join(bundledRoot, spec.slug);
}

/** Compute a short SHA-256 hash of a file's contents (sync). */
function hashFileSync(filePath: string): string {
    try {
        const content = readFileSync(filePath, 'utf-8');
        return createHash('sha256').update(content).digest('hex').substring(0, 16);
    } catch {
        return 'unknown';
    }
}

async function readPreinstalledLockVersions(sourceRoot: string): Promise<Map<string, string>> {
    const lockPath = join(sourceRoot, '.preinstalled-lock.json');
    if (!existsSync(lockPath)) {
        return new Map();
    }
    try {
        const raw = await readFile(lockPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledLockFile;
        const versions = new Map<string, string>();
        for (const entry of parsed.skills || []) {
            const slug = entry.slug?.trim();
            const version = entry.version?.trim();
            if (slug && version) {
                versions.set(slug, version);
            }
        }
        return versions;
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills lock file:', error);
        return new Map();
    }
}

/**
 * Ensure third-party preinstalled skills (bundled in app resources) are
 * deployed through SkillManager into the neutral skills-store and engine projections.
 *
 * Policy:
 * - Local built-in skills ("local": true) are ALWAYS copied over the local
 *   copy so the app-shipped version takes precedence.  Their version is derived
 *   from the sha256 hash of the bundled SKILL.md so edits are picked up.
 * - Remote skills follow the conservative rules: never overwrite user-managed
 *   skills, skip if the version already matches.
 */
export async function ensurePreinstalledSkillsInstalled(): Promise<void> {
    const skills = await readPreinstalledManifest();
    if (skills.length === 0) {
        return;
    }

    const sourceRoot = resolvePreinstalledSkillsSourceRoot();
    if (!sourceRoot) {
        logger.warn('Preinstalled skills source root not found; skipping preinstall.');
        return;
    }
    const lockVersions = await readPreinstalledLockVersions(sourceRoot);

    const { getSkillManager, PREINSTALLED_MARKER_NAME: MANAGER_PREINSTALLED_MARKER } = await import(
        '../services/skills/skill-manager'
    );
    const { getSkillEntry, resolvePackageDir } = await import('../services/skills/canonical-store');
    const manager = getSkillManager();
    const toEnable: string[] = [];

    for (const spec of skills) {
        const sourceDir = resolveSkillSourceDir(spec, sourceRoot);
        const sourceManifest = join(sourceDir, 'SKILL.md');
        if (!existsSync(sourceManifest)) {
            logger.warn(`Preinstalled skill source missing SKILL.md, skipping: ${sourceDir}`);
            continue;
        }

        const desiredVersion = spec.local
            ? hashFileSync(sourceManifest)
            : lockVersions.get(spec.slug)
                || (spec.version || 'unknown').trim()
                || 'unknown';

        const existing = await getSkillEntry({ slug: spec.slug, scope: 'global' });
        if (existing && existing.version === desiredVersion && !spec.local) {
            // Still honor autoEnable flips for already-installed remote skills.
            if (spec.autoEnable && existing.enabled === false) {
                toEnable.push(spec.slug);
            }
            continue;
        }
        if (existing && spec.local && existing.version === desiredVersion) {
            // Local skill content unchanged — still enable if autoEnable and currently off,
            // and keep OpenClaw projection in sync below when we re-enter install path.
            if (spec.autoEnable && existing.enabled === false) {
                toEnable.push(spec.slug);
            }
            // Re-project into OpenClaw package skills dir when local source exists.
            const openclawRoot = getOpenClawDir();
            if (!openclawRoot.endsWith('.asar')) {
                const openclawSkillsDir = join(openclawRoot, 'skills');
                ensureDir(openclawSkillsDir);
                const bundledTarget = join(openclawSkillsDir, spec.slug);
                if (existsSync(bundledTarget)) {
                    rmSync(bundledTarget, { recursive: true, force: true });
                }
                cpSync(sourceDir, bundledTarget, { recursive: true, dereference: true });
            }
            continue;
        }
        if (!spec.local && existing && existing.source !== 'stoclaw-preinstalled') {
            // Conservative: never overwrite user-managed skills.
            continue;
        }

        try {
            const markerPayload: PreinstalledMarker = {
                source: 'stoclaw-preinstalled',
                slug: spec.slug,
                version: desiredVersion,
                installedAt: new Date().toISOString(),
            };
            await manager.installFromLocalDir({
                slug: spec.slug,
                sourceDir,
                version: desiredVersion,
                source: 'stoclaw-preinstalled',
                enabled: Boolean(spec.autoEnable),
                scope: 'global',
                markerName: MANAGER_PREINSTALLED_MARKER || PREINSTALLED_MARKER_NAME,
                markerPayload,
            });
            if (spec.autoEnable) {
                toEnable.push(spec.slug);
            }

            // Also sync local built-in skills into OpenClaw's bundled skills directory.
            if (spec.local) {
                const openclawRoot = getOpenClawDir();
                if (!openclawRoot.endsWith('.asar')) {
                    const openclawSkillsDir = join(openclawRoot, 'skills');
                    ensureDir(openclawSkillsDir);
                    const bundledTarget = join(openclawSkillsDir, spec.slug);
                    if (existsSync(bundledTarget)) {
                        rmSync(bundledTarget, { recursive: true, force: true });
                    }
                    cpSync(sourceDir, bundledTarget, { recursive: true, dereference: true });
                }
            }

            // Keep a projection marker on openclaw runtime copy if present.
            const projected = resolvePackageDir({ slug: spec.slug, scope: 'global' });
            void projected;
        } catch (error) {
            logger.warn(`Failed to install preinstalled skill ${spec.slug}:`, error);
        }
    }

    if (toEnable.length > 0) {
        try {
            for (const slug of toEnable) {
                await manager.setEnabled(slug, true);
            }
        } catch (error) {
            logger.warn('Failed to auto-enable preinstalled skills:', error);
        }
    }
}

let localSkillsWatchStarted = false;

/**
 * Watch resources/skills in dev and re-sync local built-in skills on save.
 */
export function watchLocalSkillsForDev(): void {
    if (app.isPackaged || localSkillsWatchStarted) {
        return;
    }

    const skillsRoot = join(getResourcesDir(), 'skills');
    if (!existsSync(skillsRoot)) {
        return;
    }

    localSkillsWatchStarted = true;
    let debounceTimer: NodeJS.Timeout | null = null;

    const scheduleSync = (filename: string | null) => {
        if (filename === PREINSTALLED_MANIFEST_NAME || filename === PREINSTALLED_MARKER_NAME) {
            return;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            ensurePreinstalledSkillsInstalled().catch((error) => {
                logger.warn('Failed to sync local skills after file change:', error);
            });
        }, 400);
    };

    try {
        watch(skillsRoot, { recursive: true }, (_event, filename) => {
            scheduleSync(typeof filename === 'string' ? filename : null);
        });    } catch (error) {
        localSkillsWatchStarted = false;
        logger.warn('Failed to watch local skills directory:', error);
    }
}
