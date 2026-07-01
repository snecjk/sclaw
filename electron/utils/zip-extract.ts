/**
 * Unified ZIP extraction utility with multi-layer fallback.
 *
 * Primary: Node.js extract-zip (no external shell dependency)
 * Fallback 1 (Windows): PowerShell System.IO.Compression.ZipFile
 * Fallback 2 (Windows): PowerShell Expand-Archive
 * Fallback 3 (Unix):    unzip command
 *
 * This avoids PowerShell execution-policy / antivirus issues that
 * frequently block Expand-Archive on locked-down Windows machines.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { logger } from './logger';

function normalizeFsPathForWindows(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath) return filePath;
  if (filePath.startsWith('\\\\?\\')) return filePath;

  const windowsPath = filePath.replace(/\//g, '\\');
  if (!path.win32.isAbsolute(windowsPath)) return windowsPath;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return `\\\\?\\${windowsPath}`;
}

/** Strip \\?\ prefix for APIs that don't support it (e.g. extract-zip, PowerShell .NET) */
function stripLongPathPrefix(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (filePath.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${filePath.slice(11)}`;
  }
  if (filePath.startsWith('\\\\?\\')) {
    return filePath.slice(4);
  }
  return filePath;
}

async function extractWithNodeJs(zipPath: string, destDir: string): Promise<void> {
  // extract-zip preserves the ZIP's internal directory structure, which often
  // creates a nested root folder (e.g. "slug/skill-files"). We extract to a
  // temp directory first, then flatten a single root folder if present.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const extract = require('extract-zip');
  
  // Use os.tmpdir() for temp extraction to avoid path issues
  const os = await import('os');
  const tmpDir = path.join(os.tmpdir(), `stoclaw-skill-extract-${Date.now()}`);
  
  logger.info(`[extractZip] extractWithNodeJs: zipPath=${zipPath}, destDir=${destDir}, tmpDir=${tmpDir}`);
  
  try {
    // Ensure tmpDir exists
    fs.mkdirSync(tmpDir, { recursive: true });
    
    // Extract to temp dir (strip \\?\ prefix for extract-zip compatibility)
    const extractDest = stripLongPathPrefix(tmpDir);
    await extract(zipPath, { dir: extractDest });

    // Check what was extracted
    const entries = fs.readdirSync(tmpDir);
    logger.info(`[extractZip] tmpDir entries after extract: ${JSON.stringify(entries)}`);
    
    if (entries.length === 0) {
      logger.warn(`[extractZip] tmpDir is empty after extraction`);
      throw new Error('ZIP extraction produced no files');
    }
    
    // Ensure destDir exists
    fs.mkdirSync(destDir, { recursive: true });
    
    if (entries.length === 1) {
      const candidate = path.join(tmpDir, entries[0]);
      const stat = fs.statSync(candidate);
      logger.info(`[extractZip] single entry: ${candidate}, isDirectory=${stat.isDirectory()}`);
      
      if (stat.isDirectory()) {
        // ZIP has a single root folder: copy its contents up to destDir
        const nestedEntries = fs.readdirSync(candidate);
        logger.info(`[extractZip] nested entries: ${JSON.stringify(nestedEntries)}`);
        
        for (const name of nestedEntries) {
          const src = path.join(candidate, name);
          const dest = path.join(destDir, name);
          logger.info(`[extractZip] copying ${src} -> ${dest}`);
          fs.cpSync(src, dest, { recursive: true, force: true });
        }
        logger.info(`[extractZip] flattened single root folder to ${destDir}`);
        return;
      }
    }

    // Multiple top-level entries or single file: copy all to destDir
    logger.info(`[extractZip] copying ${entries.length} entries to ${destDir}`);
    for (const name of entries) {
      const src = path.join(tmpDir, name);
      const dest = path.join(destDir, name);
      fs.cpSync(src, dest, { recursive: true, force: true });
    }
  } finally {
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      logger.info(`[extractZip] cleaned up tmpDir`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[extractZip] failed to cleanup tmpDir: ${msg}`);
    }
  }
}

function extractWithPowerShellZipFile(zipPath: string, destDir: string): void {
  // Strip \\?\ prefix for PowerShell .NET API compatibility
  const cleanZipPath = stripLongPathPrefix(zipPath).replace(/'/g, "''");
  const cleanDestDir = stripLongPathPrefix(destDir).replace(/'/g, "''");
  const psCommand =
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
    `[System.IO.Compression.ZipFile]::ExtractToDirectory('${cleanZipPath}', '${cleanDestDir}')`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], {
    encoding: 'utf-8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'ZipFile::ExtractToDirectory failed');
  }
}

function extractWithPowerShellExpandArchive(zipPath: string, destDir: string): void {
  // Strip \\?\ prefix for PowerShell compatibility
  const cleanZipPath = stripLongPathPrefix(zipPath).replace(/'/g, "''");
  const cleanDestDir = stripLongPathPrefix(destDir).replace(/'/g, "''");
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -Path '${cleanZipPath}' -DestinationPath '${cleanDestDir}' -Force`,
    ],
    { encoding: 'utf-8', windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Expand-Archive failed');
  }
}

function extractWithUnzip(zipPath: string, destDir: string): void {
  const result = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'unzip failed');
  }
}

interface ExtractionAttempt {
  method: string;
  error: string;
}

/**
 * Extract a ZIP archive to a destination directory.
 *
 * Tries multiple methods in order and falls back gracefully.
 * On Windows, retries once if the first attempt fails (handles
 * transient file-lock issues).
 */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const normalizedZip = normalizeFsPathForWindows(zipPath);
  const normalizedDest = normalizeFsPathForWindows(destDir);

  fs.mkdirSync(normalizedDest, { recursive: true });

  const maxAttempts = process.platform === 'win32' ? 2 : 1;
  const attempts: ExtractionAttempt[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 1. Node.js extract-zip (primary, no shell dependency)
    try {
      await extractWithNodeJs(normalizedZip, normalizedDest);
      logger.info(`[extractZip] Success via Node.js extract-zip (attempt ${attempt})`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ method: `Node.js extract-zip (attempt ${attempt})`, error: msg });
      logger.warn(`[extractZip] Node.js extract-zip failed (attempt ${attempt}): ${msg}`);
    }

    // 2. PowerShell ZipFile (Windows, lower-level than Expand-Archive)
    if (process.platform === 'win32') {
      try {
        extractWithPowerShellZipFile(normalizedZip, normalizedDest);
        logger.info(`[extractZip] Success via PowerShell ZipFile (attempt ${attempt})`);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({ method: `PowerShell ZipFile (attempt ${attempt})`, error: msg });
        logger.warn(`[extractZip] PowerShell ZipFile failed (attempt ${attempt}): ${msg}`);
      }

      // 3. PowerShell Expand-Archive (legacy fallback)
      try {
        extractWithPowerShellExpandArchive(normalizedZip, normalizedDest);
        logger.info(`[extractZip] Success via PowerShell Expand-Archive (attempt ${attempt})`);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({ method: `PowerShell Expand-Archive (attempt ${attempt})`, error: msg });
        logger.warn(`[extractZip] PowerShell Expand-Archive failed (attempt ${attempt}): ${msg}`);
      }
    }

    // 4. Unix unzip command
    if (process.platform !== 'win32') {
      try {
        extractWithUnzip(normalizedZip, normalizedDest);
        logger.info(`[extractZip] Success via unzip (attempt ${attempt})`);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({ method: `unzip (attempt ${attempt})`, error: msg });
        logger.warn(`[extractZip] unzip failed (attempt ${attempt}): ${msg}`);
      }
    }

    // Retry cleanup on Windows
    if (attempt < maxAttempts && process.platform === 'win32') {
      try {
        fs.rmSync(normalizedDest, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
  }

  logger.error('[extractZip] All extraction methods failed', {
    zipPath,
    destDir,
    attempts,
  });
  throw new Error(
    `Failed to extract zip after ${maxAttempts} attempt(s). Methods tried: ` +
      attempts.map((a) => `${a.method}: ${a.error}`).join('; '),
  );
}
