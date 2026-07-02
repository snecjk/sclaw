#!/usr/bin/env zx

import 'zx/globals';
import { spawn } from 'child_process';

const ROOT_DIR = path.resolve(__dirname, '..');
const platform = os.platform();
const arch = os.arch();
const target = `${platform}-${arch}`;

function needsWinShell(bin) {
  return platform === 'win32' && !path.win32.isAbsolute(bin);
}

function runCommand(bin, args) {
  const useShell = needsWinShell(bin);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = (stderr || stdout || '(no output)').trim();
      reject(new Error(`${bin} ${args.join(' ')}\n${detail}`));
    });

    child.on('error', reject);
  });
}

// Find uv binary: prefer bundled, fallback to system PATH
const bundledUv = path.join(ROOT_DIR, 'resources', 'bin', target, platform === 'win32' ? 'uv.exe' : 'uv');
let uvBin;

if (await fs.pathExists(bundledUv)) {
  uvBin = bundledUv;
  echo(chalk.blue`📦 Using bundled uv: ${uvBin}`);
} else {
  const findUv = () => {
    if (platform === 'win32') {
      return runCommand('where.exe', ['uv']).then(({ stdout }) => {
        const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        if (!first) throw new Error('uv not found');
        return first;
      });
    }
    return runCommand('which', ['uv']).then(({ stdout }) => {
      const bin = stdout.trim().split(/\r?\n/)[0];
      if (!bin) throw new Error('uv not found');
      return bin;
    });
  };

  try {
    uvBin = await findUv();
    echo(chalk.blue`📦 Using system uv`);
  } catch {
    echo(chalk.red`❌ uv not found. Run "pnpm run uv:download" first.`);
    process.exit(1);
  }
}

// Install openpyxl for Python 3.12
echo(chalk.blue`\n📦 Installing Python dependencies...`);

try {
  // Ensure Python 3.12 is available (idempotent)
  await runCommand(uvBin, ['python', 'install', '3.12']);

  // Install openpyxl into the managed Python 3.12
  await runCommand(uvBin, ['pip', 'install', 'openpyxl', '--python', '3.12', '--system']);

  echo(chalk.green`✅ openpyxl installed successfully`);
} catch (err) {
  echo(chalk.red`❌ Failed to install Python dependencies: ${err.message}`);
  process.exit(1);
}

echo(chalk.green`\n🎉 Python dependencies installed!`);
