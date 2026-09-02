import {
  validateExternalServiceWorkspace,
  type ExternalServiceWorkspaceValidation,
} from './app-external-service-binding';

type Validator = (appPath: string) => Promise<ExternalServiceWorkspaceValidation>;

export async function assertExternalServicesReadyForDeploy(
  appPath: string,
  validate: Validator = validateExternalServiceWorkspace,
): Promise<ExternalServiceWorkspaceValidation> {
  const result = await validate(appPath);
  if (!result.valid) {
    throw Object.assign(
      new Error(`外部服务配置校验失败：${result.errors.join('；')}`),
      { statusCode: 400 },
    );
  }
  return result;
}
