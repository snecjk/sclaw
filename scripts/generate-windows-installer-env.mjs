#!/usr/bin/env zx

/**
 * Generate NSIS defines for Windows installer pre-checks.
 * Source of truth: shared/windows-install-requirements.json
 * SSO hosts align with electron/utils/sso-service.ts (SSO_ENVIRONMENTS).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const reqPath = path.join(root, 'shared', 'windows-install-requirements.json');
const outPath = path.join(root, 'scripts', 'installer-env.generated.nsh');

const buildEnv = process.env.BUILD_ENV || 'production';
const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
const ssoHost =
  req.ssoHostByBuildEnv[buildEnv] ?? req.ssoHostByBuildEnv.production;

if (!ssoHost) {
  throw new Error(`No SSO host configured for BUILD_ENV=${buildEnv}`);
}

const softChecks = (req.softCheckHosts ?? [])
  .map((item) => `${item.host}|${item.label}`)
  .join(';;');

const lines = [
  '; AUTO-GENERATED — do not edit. Run: zx scripts/generate-windows-installer-env.mjs',
  `; BUILD_ENV=${buildEnv}`,
  `!define STOCLAW_MIN_RAM_GB ${req.minRamGb}`,
  `!define STOCLAW_MIN_DISK_GB ${req.minDiskTotalGb}`,
  `!define STOCLAW_MIN_FREE_DISK_GB ${req.minDiskFreeGb}`,
  `!define STOCLAW_MIN_CPU_CORES ${req.minCpuCores}`,
  `!define STOCLAW_MIN_WIN10_BUILD ${req.minWin10Build}`,
  `!define STOCLAW_SSO_HOST "${ssoHost}"`,
  `!define STOCLAW_SOFT_CHECK_HOSTS "${softChecks}"`,
  '',
];

fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${outPath} (SSO host: ${ssoHost})`);
