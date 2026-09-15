/**
 * 建站回合后综合自检：纯函数规划（脚本优先级 + 失败修复 prompt）。
 * 实际跑命令在 electron/services/app-dev-verify.ts。
 */

export type AppDevVerifyStepName =
  | 'typecheck'
  | 'build'
  | 'test'
  | 'smoke'
  | 'preview-errors';

export interface AppDevVerifyStepPlan {
  name: AppDevVerifyStepName;
  /** npm run <script>；preview-errors / 内联 smoke 可为 null */
  script: string | null;
}

export interface AppDevVerifyStepResult {
  name: AppDevVerifyStepName;
  ok: boolean;
  output?: string;
}

const OUTPUT_TAIL = 3_500;

/** 截断命令输出尾部，避免塞进 prompt / IPC 膨胀。 */
export function truncateAppDevVerifyOutput(output: string, max = OUTPUT_TAIL): string {
  const text = output.replace(/\r\n/g, '\n').trimEnd();
  if (text.length <= max) return text;
  return `…(截断前部 ${text.length - max} 字)\n${text.slice(-max)}`;
}

/**
 * 从 package.json scripts 选出要跑的命令步：
 * 1. typecheck（或 tsc）优先；否则 build
 * 2. 有 test 再跑 test
 * smoke 由调用方按全栈状态另行追加。
 */
export function planAppDevVerifyScriptSteps(
  scripts: Record<string, unknown> | null | undefined,
): AppDevVerifyStepPlan[] {
  const names = new Set(
    Object.keys(scripts ?? {}).filter((key) => typeof scripts?.[key] === 'string' && key.trim()),
  );
  const steps: AppDevVerifyStepPlan[] = [];

  if (names.has('typecheck')) {
    steps.push({ name: 'typecheck', script: 'typecheck' });
  } else if (names.has('tsc')) {
    steps.push({ name: 'typecheck', script: 'tsc' });
  } else if (names.has('build')) {
    steps.push({ name: 'build', script: 'build' });
  }

  if (names.has('test')) {
    steps.push({ name: 'test', script: 'test' });
  }

  return steps;
}

export function buildAppDevVerifyRepairPrompt(input: {
  steps: AppDevVerifyStepResult[];
  previewErrors?: string[];
}): string {
  const failed = input.steps.filter((step) => !step.ok);
  const preview = (input.previewErrors ?? []).map((line) => line.trim()).filter(Boolean);
  const blocks: string[] = [
    '建站复检未通过，正在自动修复（业务用户看不到终端）。请根据下面的失败信息改代码，改完后我会再跑一遍复检。',
    '约束：优先修类型错误、构建错误与预览报错；不要只口头解释；不要要求用户手动跑命令。',
    '',
  ];

  for (const step of failed) {
    blocks.push(`## 失败步骤：${step.name}`);
    if (step.output?.trim()) {
      blocks.push('```');
      blocks.push(truncateAppDevVerifyOutput(step.output));
      blocks.push('```');
    } else {
      blocks.push('（无输出）');
    }
    blocks.push('');
  }

  if (preview.length > 0) {
    blocks.push('## 预览/控制台报错');
    blocks.push(...preview.slice(-15));
    blocks.push('');
  }

  blocks.push('请直接修复并保存文件。');
  return blocks.join('\n');
}

export function summarizeAppDevVerify(input: {
  steps: AppDevVerifyStepResult[];
  previewErrors?: string[];
}): { ok: boolean; prompt?: string } {
  const preview = (input.previewErrors ?? []).map((line) => line.trim()).filter(Boolean);
  const previewStep: AppDevVerifyStepResult | null = preview.length > 0
    ? {
        name: 'preview-errors',
        ok: false,
        output: preview.slice(-15).join('\n'),
      }
    : null;
  const steps = previewStep ? [...input.steps, previewStep] : input.steps;
  const ok = steps.every((step) => step.ok);
  if (ok) return { ok: true };
  return {
    ok: false,
    prompt: buildAppDevVerifyRepairPrompt({
      steps,
      previewErrors: preview,
    }),
  };
}
