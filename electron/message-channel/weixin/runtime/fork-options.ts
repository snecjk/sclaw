/**
 * Weixin utilityProcess fork options (mirrors pi-runtime/fork-options).
 */

export function buildWeixinUtilityForkOptions(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  execArgv?: string[];
}): {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: 'pipe';
  serviceName: string;
  execArgv?: string[];
} {
  const options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: 'pipe';
    serviceName: string;
    execArgv?: string[];
  } = {
    cwd: input.cwd,
    env: input.env,
    stdio: 'pipe',
    serviceName: 'SClaw Weixin Runtime',
  };
  if (input.execArgv && input.execArgv.length > 0) {
    options.execArgv = input.execArgv;
  }
  return options;
}
