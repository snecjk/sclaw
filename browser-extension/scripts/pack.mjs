import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;
const distDir = join(root, 'dist');
mkdirSync(distDir, { recursive: true });
const zipName = `stoclaw-browser-bridge-${version}.zip`;
const zipPath = join(distDir, zipName);
if (existsSync(zipPath)) {
  execFileSync('rm', [zipPath]);
}
const files = [
  'manifest.json',
  'background.js',
  'cdp-allowlist.js',
  'page-agent.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];
execFileSync('zip', ['-q', zipPath, ...files], { cwd: root });
writeFileSync(join(distDir, 'VERSION'), `${version}\n`);
console.log(zipPath);
