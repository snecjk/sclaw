/**
 * 建站回合后综合自检：按 package.json scripts 跑 typecheck/build/test，
 * 全栈可附带 smoke；结果拼修复 prompt 给建站会话自愈。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  planAppDevVerifyScriptSteps,
  summarizeAppDevVerify,
  truncateAppDevVerifyOutput,
  type AppDevVerifyStepResult,
} from '../../shared/app-dev-verify';
import { getManagedNodePaths, getNodeSpawnEnv } from '../utils/node-runtime';
import { prepareWinSpawn } from '../utils/win-shell';
import { logger } from '../utils/logger';
import {
  getRuntimeStatus,
  restartBackendOnly,
  runAppSmoke,
} from './app-runtime-manager';
import { isFullstackAppMarker, readAppDevMarker } from './app-dev-service';

const SCRIPT_TIMEOUT_MS = 90_000;

export interface RunAppDevVerifyInput {
  workspaceId: string;
  appPath: string;
  /** 预览/控制台报错（前端 drain 后传入） */
  previewErrors?: string[];
  /** 是否尝试全栈 smoke（默认 true；无 fullstack/后端则跳过） */
  includeSmoke?: boolean;
}

export interface RunAppDevVerifyResult {
  ok: boolean;
  steps: AppDevVerifyStepResult[];
  prompt?: string;
}

function spawnNpm(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): ChildProcess {
  const { npmBin } = getManagedNodePaths();
  if (!npmBin) throw new Error('未找到可用的 npm');
  const prepared = prepareWinSpawn(npmBin, args);
  return spawn(prepared.command, prepared.args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: prepared.shell,
  });
}

async function readPackageScripts(appPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(appPath, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : null;
  } catch {
    return null;
  }
}

function runNpmScript(
  appPath: string,
  script: string,
  timeoutMs = SCRIPT_TIMEOUT_MS,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let child: ChildProcess;
    try {
      child = spawnNpm(['run', script], {
        cwd: appPath,
        env: getNodeSpawnEnv() as NodeJS.ProcessEnv,
      });
    } catch (err) {
      resolve({
        ok: false,
        output: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      resolve({
        ok: false,
        output: truncateAppDevVerifyOutput(`${output}\n[timeout] npm run ${script} > ${timeoutMs}ms`),
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    child.stderr?.on('data', (chunk) => { output += String(chunk); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, output: truncateAppDevVerifyOutput(`${output}\n${err.message}`) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        output: truncateAppDevVerifyOutput(output),
      });
    });
  });
}

export async function runAppDevVerify(input: RunAppDevVerifyInput): Promise<RunAppDevVerifyResult> {
  const { workspaceId, appPath } = input;
  const steps: AppDevVerifyStepResult[] = [];
  const scripts = await readPackageScripts(appPath);
  const planned = planAppDevVerifyScriptSteps(scripts);

  for (const step of planned) {
    if (!step.script) continue;
    logger.info('[app-dev-verify] running', { workspaceId, script: step.script, name: step.name });
    const result = await runNpmScript(appPath, step.script);
    steps.push({
      name: step.name,
      ok: result.ok,
      output: result.output || undefined,
    });
  }

  const includeSmoke = input.includeSmoke !== false;
  const marker = await readAppDevMarker(appPath).catch(() => null);
  if (includeSmoke && isFullstackAppMarker(marker)) {
    try {
      await restartBackendOnly(workspaceId, appPath);
      const status = getRuntimeStatus(workspaceId, appPath);
      if (status.backendUrl) {
        try {
          const output = await runAppSmoke(appPath, status.backendUrl);
          steps.push({
            name: 'smoke',
            ok: true,
            output: truncateAppDevVerifyOutput(output) || undefined,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          steps.push({
            name: 'smoke',
            ok: false,
            output: truncateAppDevVerifyOutput(message),
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      steps.push({
        name: 'smoke',
        ok: false,
        output: truncateAppDevVerifyOutput(`重启后端失败：${message}`),
      });
    }
  }

  const summary = summarizeAppDevVerify({
    steps,
    previewErrors: input.previewErrors,
  });

  const preview = (input.previewErrors ?? []).map((line) => line.trim()).filter(Boolean);
  const allSteps: AppDevVerifyStepResult[] = preview.length > 0
    ? [
        ...steps,
        {
          name: 'preview-errors',
          ok: false,
          output: preview.slice(-15).join('\n'),
        },
      ]
    : steps;

  return {
    ok: summary.ok,
    steps: allSteps,
    prompt: summary.prompt,
  };
}
