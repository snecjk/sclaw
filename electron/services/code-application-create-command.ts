export type CodeApplicationPageType = 'site' | 'assets';

export interface CodeApplicationCreateCommandInput {
  applicationUid: string;
  applicationCode: string;
  applicationName: string;
  description?: string | null;
  pageType?: CodeApplicationPageType;
}

export function buildCodeApplicationCreateArgs(
  input: CodeApplicationCreateCommandInput,
): string[] {
  const args = [
    'policy', 'code-application', 'create',
    '--applicationUid', input.applicationUid,
    '--applicationCode', input.applicationCode,
    '--applicationName', input.applicationName,
    '--pageType', input.pageType === 'assets' ? 'assets' : 'site',
  ];
  const description = input.description?.trim();
  if (description) args.push('--description', description);
  return args;
}
