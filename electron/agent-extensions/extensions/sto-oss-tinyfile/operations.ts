import { Type, type Static } from 'typebox';
import {
  sclawToolFailure,
  type SclawToolDefinition,
  type SclawToolOutcome,
} from '../../../../shared/agent-extensions';
import {
  OSS_TINY_FILE_EXPIRES_SECONDS,
  STO_OSS_TINY_FILE_CAPABILITY,
} from './capability';

const uploadSchema = Type.Object({
  filePath: Type.String({
    minLength: 1,
    description: '要上传的本地文件路径。支持绝对路径；相对路径按当前 Agent 工作目录解析。',
  }),
  fileName: Type.Optional(Type.String({
    minLength: 1,
    description: '可选的在线文件显示名称；默认使用本地文件名。',
  })),
});

async function run<T>(handler: () => Promise<T>): Promise<SclawToolOutcome<T>> {
  try {
    return {
      success: true,
      type: 'oss_file_uploaded',
      domain: 'oss',
      data: await handler(),
      message: '文件已上传，在线地址有效期为 7 天。',
    };
  } catch (error) {
    return sclawToolFailure(
      'oss',
      'sto_oss_tiny_file_error',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export const uploadFileToTempOssTool: SclawToolDefinition<typeof uploadSchema> = {
  name: 'upload_file_to_temp_oss',
  label: '上传文件并获取在线地址',
  description: '将一个本地文件上传到 STO OSS，返回有效期为 7 天的临时在线地址。',
  engines: ['claude', 'pi'],
  modes: ['interactive', 'scheduled'],
  parameters: uploadSchema,
  async execute(input: Static<typeof uploadSchema>, context) {
    return run(async () => {
      const filePath = input.filePath.trim();
      const fileName = input.fileName?.trim() || undefined;
      const uploaded = await context.capabilities.require(STO_OSS_TINY_FILE_CAPABILITY).upload({
        filePath,
        fileName,
        cwd: context.cwd,
        signal: context.signal,
      });
      return {
        url: uploaded.url,
        tempUrl: uploaded.tempUrl,
        resourceId: uploaded.resourceId,
        ossKey: uploaded.ossKey,
        fileName: uploaded.name ?? fileName ?? null,
        fileType: uploaded.fileType,
        expiresSeconds: OSS_TINY_FILE_EXPIRES_SECONDS,
        temporary: true,
      };
    });
  },
};

export const stoOssTinyFileTools = [uploadFileToTempOssTool] as const;
