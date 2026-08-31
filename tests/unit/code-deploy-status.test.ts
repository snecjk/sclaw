import { describe, expect, it } from 'vitest';
import {
  codeDeployStatusLabel,
  extractDeploymentIdFromText,
  formatCodeDeployFailurePrompt,
  formatCodeDeployImmediateFailureMessage,
  isCodeDeployFailed,
  isCodeDeployInProgress,
  isCodeDeploySuccess,
  isCodeDeployTerminal,
  normalizeCodeDeployStatus,
  pickCodeDeployFields,
} from '../../shared/code-deploy-status';

describe('code-deploy-status', () => {
  it('normalizes and labels known statuses', () => {
    expect(normalizeCodeDeployStatus(' building ')).toBe('BUILDING');
    expect(codeDeployStatusLabel('SUCCESS')).toBe('部署成功');
    expect(codeDeployStatusLabel('FAILED')).toBe('部署失败');
    expect(codeDeployStatusLabel('weird')).toBe('WEIRD');
  });

  it('classifies terminal / in-progress / failed', () => {
    expect(isCodeDeployInProgress('BUILDING')).toBe(true);
    expect(isCodeDeployInProgress('CREATED')).toBe(true);
    expect(isCodeDeployTerminal('SUCCESS')).toBe(true);
    expect(isCodeDeployTerminal('FAILED')).toBe(true);
    expect(isCodeDeployTerminal('CANCELLED')).toBe(true);
    expect(isCodeDeploySuccess('SUCCESS')).toBe(true);
    expect(isCodeDeployFailed('FAILED')).toBe(true);
    expect(isCodeDeployFailed('CANCELLED')).toBe(true);
    expect(isCodeDeployFailed('BUILDING')).toBe(false);
  });

  it('builds an AI repair prompt from failure fields', () => {
    const fields = pickCodeDeployFields({
      deploymentId: 'dep-1',
      applicationId: 'app-1',
      env: 'daily',
      status: 'FAILED',
      failureStage: 'BUILD',
      failureMessage: 'npm run build failed',
      pipelineInstanceId: 'pipe-9',
    });
    const prompt = formatCodeDeployFailurePrompt(fields);
    expect(prompt).toContain('应用发布失败');
    expect(prompt).toContain('FAILED');
    expect(prompt).toContain('daily');
    expect(prompt).toContain('dep-1');
    expect(prompt).toContain('BUILD');
    expect(prompt).toContain('npm run build failed');
  });

  it('uses fallbackMessage when failureMessage is missing', () => {
    const prompt = formatCodeDeployFailurePrompt(
      { env: 'daily', applicationId: 'app-1' },
      { fallbackMessage: 'registry request failed: 403 Forbidden' },
    );
    expect(prompt).toContain('FAILED');
    expect(prompt).toContain('daily');
    expect(prompt).toContain('app-1');
    expect(prompt).toContain('registry request failed: 403 Forbidden');
  });

  it('unwraps sai-cli create/list envelopes to the deploy record', () => {
    const fields = pickCodeDeployFields({
      input: { applicationId: 'app-1', env: 'daily' },
      path: 'policy.code-deploy.create',
      result: {
        statusCode: 200,
        body: {
          success: true,
          data: {
            deploymentId: 'dep_nested_1',
            applicationId: 'app-1',
            env: 'daily',
            status: 'BUILDING',
            pipelineInstanceId: 7946,
            deploymentVersion: '1.4.0',
            revisionId: 'rev-14',
            failureMessage: null,
          },
        },
      },
    });
    expect(fields).toMatchObject({
      deploymentId: 'dep_nested_1',
      applicationId: 'app-1',
      env: 'daily',
      status: 'BUILDING',
      pipelineInstanceId: '7946',
      deploymentVersion: '1.4.0',
      revisionId: 'rev-14',
    });
  });

  it('unwraps list envelopes that return an array of records', () => {
    const fields = pickCodeDeployFields({
      path: 'policy.code-deploy.list',
      result: {
        body: {
          data: [
            { deploymentId: 'dep_latest', status: 'BUILDING', env: 'daily' },
            { deploymentId: 'dep_old', status: 'SUCCESS', env: 'daily' },
          ],
        },
      },
    });
    expect(fields.deploymentId).toBe('dep_latest');
    expect(fields.status).toBe('BUILDING');
  });

  it('unwraps siteapp snake_case deploy records', () => {
    const fields = pickCodeDeployFields({
      path: 'siteapp.deploy.create',
      result: {
        body: {
          data: {
            deployment_id: 'dep_siteapp_1',
            app_code: 'app_test',
            env: 'daily',
            status: 'failed',
            failure_stage: 'create_iteration',
            failure_message: '版本已存在',
            deployment_version: '2026.08.31.1335',
            revision_id: 'rev_1',
          },
        },
      },
    });
    expect(fields).toMatchObject({
      deploymentId: 'dep_siteapp_1',
      applicationId: 'app_test',
      env: 'daily',
      status: 'failed',
      failureStage: 'create_iteration',
      failureMessage: '版本已存在',
      deploymentVersion: '2026.08.31.1335',
      revisionId: 'rev_1',
    });
  });

  it('extracts deployment id from busy downstream text', () => {
    expect(extractDeploymentIdFromText(
      '当前环境已有发布正在执行：dep_23da553e188f35b444195aec7588636e',
    )).toBe('dep_23da553e188f35b444195aec7588636e');
  });

  it('formats immediate deploy failure message', () => {
    expect(formatCodeDeployImmediateFailureMessage({
      status: 'FAILED',
      failureStage: 'create_iteration',
      failureMessage: '版本已存在',
    })).toBe('版本已存在 · 阶段：create_iteration');
  });
});
