import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  canonicalizeWorkflowArtifacts,
  contentTypeForPath,
  normalizeArtifactFirstPayloadSchema,
  promoteCarriedOutputArtifacts,
  validateInlinePayload,
} from '../../electron/services/workflow-runtime/artifact-output';
import {
  claudeStructuredOutputEnvelopeJsonSchema,
  createWorkflowPacket,
  normalizeWorkflowArtifactDrafts,
  validateWorkflowPacket,
  workflowPacketJsonSchema,
  type WorkflowPacket,
} from '../../electron/services/workflow-runtime/workflow-packet';
import { buildWorkflowNodePrompt } from '../../electron/services/workflow-runtime/prompt-builder';
import { resolveNodeInput, WORKFLOW_PACKET_ARTIFACTS_KEY } from '../../electron/services/workflow-runtime/input-resolver';
import { runAgentNodeWithRetry } from '../../electron/services/workflow-runtime/agent-retry';
import { hydrateNodeInputFiles } from '../../electron/services/workflow-runtime/node-input-files';
import { mapWfRunRowToResponse } from '../../electron/services/workflow-runtime/mapper';

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'stoclaw-artifact-output-'));
  tempPaths.push(workspace);
  return workspace;
}

function submission(artifacts: unknown[] = [], payload: unknown = { summary: 'ok' }): WorkflowPacket {
  return createWorkflowPacket({
    runId: 'run-1', nodeId: 'node-1', nodeType: 'agent_output', attempt: 1, payload,
    artifacts: artifacts as WorkflowPacket['artifacts'],
  });
}

describe('workflow artifact-first output', () => {
  it.each([
    ['result.html', 'text/html'],
    ['result.md', 'text/markdown'],
    ['result.json', 'application/json'],
    ['result.csv', 'text/csv'],
    ['result.pdf', 'application/pdf'],
    ['result.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['result.png', 'image/png'],
    ['result.custom', 'application/octet-stream'],
  ])('infers %s without a format allowlist', (fileName, expected) => {
    expect(contentTypeForPath(fileName)).toBe(expected);
  });

  it('accepts zero artifacts and canonicalizes multiple declared files exactly once', async () => {
    const workspace = await tempWorkspace();
    await mkdir(path.join(workspace, 'outputs'));
    await writeFile(path.join(workspace, 'outputs', 'report.html'), '<!doctype html><html><body>ok</body></html>');
    await writeFile(path.join(workspace, 'outputs', 'data.custom'), 'custom data');

    const empty = await canonicalizeWorkflowArtifacts(submission(), { runId: 'run-1', nodeId: 'node-1', workspace, defaultKind: 'OUTPUT' });
    expect(empty.ok && empty.value.artifacts).toEqual([]);

    const result = await canonicalizeWorkflowArtifacts(submission([
      { resourceId: 'outputs/report.html', kind: 'OUTPUT', name: '行程报告' },
      { resourceId: 'outputs/data.custom', kind: 'INTERMEDIATE' },
      { resourceId: 'outputs/report.html', kind: 'OUTPUT' },
    ]), { runId: 'run-1', nodeId: 'node-1', workspace, defaultKind: 'OUTPUT' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artifacts).toHaveLength(2);
    expect(result.value.artifacts[0]).toMatchObject({
      kind: 'OUTPUT', name: '行程报告', contentType: 'text/html', resourceId: 'outputs/report.html',
    });
    expect(result.value.artifacts[1]).toMatchObject({
      kind: 'INTERMEDIATE', name: 'data.custom', contentType: 'application/octet-stream',
    });
    expect(result.value.artifacts[0].artifactId).toMatch(/^run-1:node-1:[a-f0-9]{16}$/);

    const again = await canonicalizeWorkflowArtifacts(submission([{ resourceId: 'outputs/report.html' }]), {
      runId: 'run-1', nodeId: 'node-1', workspace, defaultKind: 'OUTPUT',
    });
    expect(again.ok && again.value.artifacts[0].artifactId).toBe(result.value.artifacts[0].artifactId);
  });

  it.each([
    ['absolute', (workspace: string) => path.join(workspace, 'report.txt')],
    ['traversal', () => '../report.txt'],
    ['missing', () => 'missing.txt'],
    ['directory', () => 'folder'],
    ['empty', () => 'empty.txt'],
  ])('rejects an invalid %s resource', async (_name, resourceId) => {
    const workspace = await tempWorkspace();
    await mkdir(path.join(workspace, 'folder'));
    await writeFile(path.join(workspace, 'report.txt'), 'ok');
    await writeFile(path.join(workspace, 'empty.txt'), '');
    const result = await canonicalizeWorkflowArtifacts(submission([{ resourceId: resourceId(workspace) }]), {
      runId: 'run-1', nodeId: 'node-1', workspace,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a symbolic-link escape from the workspace', async () => {
    const workspace = await tempWorkspace();
    const outside = await tempWorkspace();
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await canonicalizeWorkflowArtifacts(submission([{ resourceId: 'escape/secret.txt' }]), {
      runId: 'run-1', nodeId: 'node-1', workspace,
    });
    expect(result).toMatchObject({ ok: false, code: 'ARTIFACT_RESOURCE_INVALID' });
  });

  it('enforces the exact 1024-byte inline boundary and rejects legacy payload.html', () => {
    expect(validateInlinePayload({ text: 'a'.repeat(1024) })).toMatchObject({ ok: true });
    expect(validateInlinePayload({ text: 'a'.repeat(1025) })).toMatchObject({ ok: false, code: 'RESULT_LARGE_TEXT_INLINE' });
    expect(validateInlinePayload({ html: '<!doctype html><html></html>' })).toMatchObject({ ok: false, code: 'RESULT_LEGACY_INLINE_ARTIFACT' });
  });

  it('keeps a 7.9 KB HTML deliverable out of the canonical packet', async () => {
    const workspace = await tempWorkspace();
    const html = `<!doctype html><html><body>${'x'.repeat(7875)}</body></html>`;
    expect(Buffer.byteLength(html, 'utf8')).toBeGreaterThanOrEqual(7900);
    await writeFile(path.join(workspace, 'report.html'), html);
    const result = await canonicalizeWorkflowArtifacts(submission([{ resourceId: 'report.html', kind: 'OUTPUT' }]), {
      runId: 'run-1', nodeId: 'node-1', workspace, defaultKind: 'OUTPUT',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.value);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(1024);
    expect(serialized).not.toContain('<!doctype');
    expect(result.value.artifacts[0].size).toBe(Buffer.byteLength(html, 'utf8'));
  });

  it('normalizes a legacy html payload schema without retaining inline fields', () => {
    const schema = normalizeArtifactFirstPayloadSchema({
      type: 'object', additionalProperties: false, required: ['html'],
      properties: { html: { type: 'string' }, fileName: { type: 'string' } },
    }) as any;
    expect(schema.required).toBeUndefined();
    expect(schema.properties.html).toBeUndefined();
    expect(schema.properties.fileName).toBeUndefined();
    expect(schema.properties.summary).toMatchObject({ type: 'string', maxLength: 1024 });
  });

  it('validates drafts before canonical references and keeps both engine transports aligned', () => {
    const draftPacket = submission([{ resourceId: 'report.html', kind: 'OUTPUT' }]);
    expect(validateWorkflowPacket(draftPacket, {
      runId: 'run-1', nodeId: 'node-1', nodeType: 'agent_output', artifactMode: 'draft',
    })).toMatchObject({ ok: true });
    expect(validateWorkflowPacket(draftPacket, {
      runId: 'run-1', nodeId: 'node-1', nodeType: 'agent_output',
    })).toMatchObject({ ok: false, code: 'ARTIFACT_INVALID' });

    const openClawSchema = workflowPacketJsonSchema({ type: 'object' }, { runId: 'run-1', nodeId: 'node-1', nodeType: 'agent_output' }) as any;
    expect(openClawSchema.properties.artifacts.items.required).toEqual(['resourceId']);
    expect(claudeStructuredOutputEnvelopeJsonSchema()).toMatchObject({ required: ['payload'] });
  });

  it('strips only host-owned metadata from copied canonical artifact references', () => {
    const copiedReference = submission([{
      resourceId: 'report.html', kind: 'OUTPUT', name: 'report', contentType: 'text/html',
      artifactId: 'host-id', uri: 'artifact://run/node/host-id', size: 100, checksum: 'legacy',
    } as any]);
    const normalized = normalizeWorkflowArtifactDrafts(copiedReference);

    expect(normalized).toMatchObject({
      normalized: true,
      stripped: [{ index: 0, fields: ['artifactId', 'uri', 'size', 'checksum'] }],
    });
    expect((normalized.packet as WorkflowPacket).artifacts).toEqual([{
      resourceId: 'report.html', kind: 'OUTPUT', name: 'report', contentType: 'text/html',
    }]);
    expect(validateWorkflowPacket(normalized.packet, {
      runId: 'run-1', nodeId: 'node-1', nodeType: 'agent_output', artifactMode: 'draft',
    })).toMatchObject({ ok: true });
  });

  it('keeps unknown artifact fields for strict validation and reports the exact artifact', () => {
    const packet = submission([{ resourceId: 'report.html', unexpected: true } as any]);
    const normalized = normalizeWorkflowArtifactDrafts(packet);
    expect(normalized.normalized).toBe(false);
    expect(validateWorkflowPacket(normalized.packet, {
      runId: 'run-1', nodeId: 'node-1', nodeType: 'agent_output', artifactMode: 'draft',
    })).toMatchObject({
      ok: false,
      code: 'ARTIFACT_DRAFT_INVALID',
      message: 'artifacts[0] 包含不允许字段: unexpected；只允许 resourceId、kind、name、contentType',
    });
  });

  it('reports the exact artifact when resourceId is missing', () => {
    expect(validateWorkflowPacket(submission([{ kind: 'OUTPUT' } as any]), {
      runId: 'run-1', nodeId: 'node-1', nodeType: 'agent_output', artifactMode: 'draft',
    })).toMatchObject({
      ok: false,
      code: 'ARTIFACT_DRAFT_INVALID',
      message: 'artifacts[0].resourceId 必须是非空字符串',
    });
  });

  it('promotes carried OUTPUT artifacts without creating or copying a result file', () => {
    const artifact = {
      artifactId: 'run-1:source:abc', kind: 'OUTPUT' as const, name: 'report.html', contentType: 'text/html',
      resourceId: 'report.html', uri: 'artifact://run-1/source/run-1:source:abc', size: 100,
    };
    const packet = submission([], {
      summary: 'done',
      [WORKFLOW_PACKET_ARTIFACTS_KEY]: [{ sourceNodeId: 'source', artifact, mountedResourceId: 'inputs/02-report.html' }],
    });
    const promoted = promoteCarriedOutputArtifacts(packet);
    expect(promoted.payload).toEqual({ summary: 'done' });
    expect(promoted.artifacts).toEqual([artifact]);
    expect(promoted.artifacts[0].resourceId).toBe('report.html');
  });

  it('does not hydrate or rewrite artifacts for a terminal output node', async () => {
    const artifact = {
      artifactId: 'run-1:source:abc', kind: 'OUTPUT' as const, name: 'report.html', contentType: 'text/html',
      resourceId: 'report.html', uri: 'artifact://run-1/source/run-1:source:abc', size: 100,
    };
    const input = { [WORKFLOW_PACKET_ARTIFACTS_KEY]: [{ sourceNodeId: 'source', artifact }] };
    const result = await hydrateNodeInputFiles({ id: 'end_node', type: 'output' }, input, 'run-missing-on-purpose');
    expect(result).toEqual({ input, files: [] });
  });

  it('shows a consumer mount path to an agent without changing the carried canonical reference', () => {
    const artifact = {
      artifactId: 'run-1:source:abc', kind: 'INTERMEDIATE' as const, name: '天气分析', contentType: 'text/markdown',
      resourceId: 'weather_report.md', uri: 'artifact://run-1/source/run-1:source:abc', size: 100,
    };
    const carried = [{ sourceNodeId: 'source', artifact, mountedResourceId: 'inputs/01-weather_report.md' }];
    const prompt = buildWorkflowNodePrompt({
      task: { goal: '读取天气分析', instruction: '', name: 'consume' },
      completionContract: { dataJsonSchema: { type: 'object' } },
      runtimeContext: { workspacePath: 'C:/runtime/consumer', startup: { schema: {}, resolvedInputs: {} }, isFirstAgentNode: false },
      permissionPolicy: { mode: 'workspace_write' },
    } as any, { id: 'consumer', type: 'agent_task', name: '消费', config: {} }, {
      runId: 'run-1', resolvedInputs: { [WORKFLOW_PACKET_ARTIFACTS_KEY]: carried },
    } as any, { execEngine: 'openclaw', attempt: 1 });
    expect(prompt).toContain('inputs/01-weather_report.md');
    expect(carried[0].artifact.resourceId).toBe('weather_report.md');
  });

  it('maps local artifacts to absolute preview paths without polluting the canonical output packet', () => {
    const filePath = path.resolve('C:/Users/test/.stoclaw/workflow-runtime/workspaces/run-1/source/report.html');
    const canonicalOutput = submission([{
      artifactId: 'run-1:source:abc', kind: 'OUTPUT', name: 'report.html', contentType: 'text/html',
      resourceId: 'report.html', uri: 'artifact://run-1/source/run-1:source:abc', size: 100,
    }]);
    const response = mapWfRunRowToResponse({
      run_id: 'run-1', workflow_id: 'workflow-1', version_id: 'v1', status: 'SUCCEEDED',
      started_at: '2026-07-30T10:00:00+08:00', output_json: JSON.stringify(canonicalOutput),
      last_agent_output_json: JSON.stringify(canonicalOutput), definition_json: '{}',
    } as any, { artifacts: [{
      artifact_id: 'run-1:source:abc', node_id: 'source', kind: 'OUTPUT', summary: 'report.html',
      content_type: 'text/html', file_path: filePath, uri: 'artifact://run-1/source/run-1:source:abc',
    }] });

    expect(response.artifacts[0]).toMatchObject({
      id: 'run-1:source:abc', filePath, url: expect.stringMatching(/^file:\/\//),
    });
    expect(response.output.artifacts[0]).toMatchObject({
      resourceId: 'report.html', uri: 'artifact://run-1/source/run-1:source:abc', filePath,
      url: expect.stringMatching(/^file:\/\//),
    });
  });

  it('keeps status compact and exposes heavy run data only in explicit views', () => {
    const row = {
      run_id: 'run-1', workflow_id: 'workflow-1', version_id: 'v1', workflow_version: '1.0',
      status: 'SUCCEEDED', mode: 'CLIENT_LOCAL', engine_type: 'claude', engine_model: 'test/model',
      started_at: '2026-07-30T10:00:00+08:00', completed_at: '2026-07-30T10:01:00+08:00',
      input_json: '{"secret":"diagnostic-only"}', output_json: JSON.stringify(submission()),
      last_agent_output_json: JSON.stringify(submission()), last_agent_raw_text: 'raw diagnostic text',
      definition_json: '{"version":"1.0","nodes":[]}', error: '',
    };
    const children = {
      nodeRuns: [{
        run_id: 'run-1', node_id: 'source', node_type: 'agent_output', status: 'SUCCEEDED',
        started_at: row.started_at, completed_at: row.completed_at,
        input_json: '{"large":"input"}', output_json: '{"large":"output"}', attempt_count: 2,
        agent_session_id: 'session-secret',
      }],
      events: [{
        run_id: 'run-1', sequence: 1, type: 'agent.tool_end', node_id: 'source',
        created_at: row.completed_at, message: '{"large":"event"}', call_id: 'call-1', tool_id: 'tool-1',
      }],
      artifacts: [
        { artifact_id: 'out', node_id: 'source', kind: 'OUTPUT', summary: 'report.html', content_type: 'text/html', file_path: 'C:/out/report.html' },
        { artifact_id: 'tmp', node_id: 'source', kind: 'INTERMEDIATE', summary: 'notes.md', content_type: 'text/markdown', file_path: 'C:/out/notes.md' },
      ],
    };

    const status = mapWfRunRowToResponse(row as any, children as any);
    expect(status.artifacts.map((artifact: any) => artifact.id)).toEqual(['out']);
    expect(status.nodeRuns[0]).not.toHaveProperty('input');
    expect(status.nodeRuns[0]).not.toHaveProperty('output');
    for (const key of ['events', 'toolInvocations', 'input', 'result', 'startup', 'lastAgentRawText', 'engineModel']) {
      expect(status).not.toHaveProperty(key);
    }
    const compactJson = JSON.stringify(status);
    expect(compactJson).not.toContain('diagnostic-only');
    expect(compactJson).not.toContain('session-secret');
    expect(compactJson).not.toContain('"large":"event"');

    const detail = mapWfRunRowToResponse(row as any, { ...children, view: 'detail' } as any);
    expect(detail.events).toHaveLength(1);
    expect(detail.lastAgentRawText).toBe('raw diagnostic text');
    expect(detail.nodeRuns[0]).not.toHaveProperty('input');
    expect(detail).not.toHaveProperty('toolInvocations');

    const diagnostic = mapWfRunRowToResponse(row as any, { ...children, view: 'diagnostic' } as any);
    expect(diagnostic.artifacts).toHaveLength(2);
    expect(diagnostic.nodeRuns[0]).toMatchObject({
      input: { large: 'input' }, output: { large: 'output' }, attemptCount: 2, agentSessionId: 'session-secret',
    });
    expect(diagnostic).toHaveProperty('input');
    expect(diagnostic).toHaveProperty('result');
    expect(diagnostic).not.toHaveProperty('toolInvocations');
  });

  it('builds a compact artifact-first prompt without the legacy HTML contract or duplicated templates', () => {
    const prompt = buildWorkflowNodePrompt({
      task: { goal: '生成 HTML 报告', instruction: '', name: 'report' },
      completionContract: { dataJsonSchema: normalizeArtifactFirstPayloadSchema({ type: 'object', required: ['html'], properties: { html: { type: 'string' } } }) },
      runtimeContext: { workspacePath: 'C:/runtime/node', startup: { schema: {}, resolvedInputs: {} }, isFirstAgentNode: true },
      permissionPolicy: { mode: 'readonly' },
    } as any, { id: 'node-1', type: 'agent_output', name: '输出', config: {} }, {
      runId: 'run-1', resolvedInputs: {},
    } as any, { execEngine: 'claude', attempt: 1 });
    expect(prompt).toContain('产物格式由任务要求和内容决定');
    expect(prompt).toContain('resourceId');
    expect(prompt).not.toContain('payload.html 必须');
    expect(prompt).not.toContain('## 结果模板');
    expect(prompt).not.toContain('"artifactId":');
    expect(prompt).toContain('当前节点为只读模式');
  });

  it('reports obsolete payload.html bindings with a stable diagnostic', () => {
    expect(() => resolveNodeInput({
      id: 'consumer',
      config: { input: { bindings: [{ sourceNodeId: 'source', sourcePort: 'html', toField: 'report', required: true }] } },
    }, { runInput: {}, upstream: { source: submission() } })).toThrow(/RESULT_LEGACY_PAYLOAD_HTML_BINDING/);
    expect(() => resolveNodeInput({
      id: 'consumer',
      config: { inputs: { inputBindings: { report: '{{nodes.source.output.html}}' } } },
    }, { runInput: {}, upstream: { source: submission() } })).toThrow(/RESULT_LEGACY_PAYLOAD_HTML_BINDING/);
  });

  it.each(['claude', 'openclaw'] as const)('returns the same canonical packet through the %s retry path', async (execEngine) => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, 'report.md'), '# report');
    const draft = submission([{ resourceId: 'report.md', kind: 'OUTPUT' }]);
    const output = execEngine === 'claude' ? { payload: JSON.stringify(draft) } : draft;
    const repo = {
      getNodeRun: async () => undefined,
      incrementNodeAttempt: async () => undefined,
      upsertNodeRun: async () => undefined,
      enqueueOutbox: async () => undefined,
    };
    const result = await runAgentNodeWithRetry({
      runId: 'run-1', workflowId: 'workflow-1', versionId: 'v1', definition: {}, repo,
      resolvedInputs: {}, emit: async () => undefined,
    } as any, { id: 'node-1', type: 'agent_output', config: {} }, {
      schemaVersion: 'agent-run-spec/v1', workflowId: 'workflow-1', workflowVersion: 'v1', runId: 'run-1', nodeId: 'node-1',
      task: { name: 'report', goal: 'create report', instruction: '' },
      target: { provider: 'client_local', kind: 'agent_output', model: 'test' },
      inputs: {}, allowedSkills: [], allowedTools: [], outputSchema: '', metadata: {},
      runtimeContext: { startup: { schema: {}, resolvedInputs: {} }, isFirstAgentNode: true, workspacePath: workspace },
      permissionPolicy: { mode: 'workspace_write' }, limits: {},
      completionContract: { dataJsonSchema: { type: 'object' }, outputJsonSchema: { type: 'object' }, maxAttempts: 1, onIncomplete: 'retry' },
      prompt: '',
    }, {
      execEngine,
      quota: async () => true,
      invokeAgent: async () => ({ status: 'succeeded', rawText: JSON.stringify(draft), output }),
    });
    expect(result.status).toBe('succeeded');
    expect(result.rawText).toBe('');
    expect(result.output.artifacts).toHaveLength(1);
    expect(result.output.artifacts[0]).toMatchObject({ resourceId: 'report.md', contentType: 'text/markdown', kind: 'OUTPUT' });
  });

  it.each(['claude', 'openclaw'] as const)('normalizes copied host artifact metadata through the %s retry path', async (execEngine) => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, 'report.md'), '# report');
    const draft = submission([{
      resourceId: 'report.md', kind: 'OUTPUT', artifactId: 'copied-id',
      uri: 'artifact://copied', size: 8, checksum: 'copied-checksum',
    } as any]);
    const output = execEngine === 'claude' ? { payload: JSON.stringify(draft) } : draft;
    const events: Array<{ type: string; payload: any }> = [];
    const repo = {
      getNodeRun: async () => undefined,
      incrementNodeAttempt: async () => undefined,
      upsertNodeRun: async () => undefined,
      enqueueOutbox: async () => undefined,
    };
    const result = await runAgentNodeWithRetry({
      runId: 'run-1', workflowId: 'workflow-1', versionId: 'v1', definition: {}, repo,
      resolvedInputs: {}, emit: async (type: string, payload: any) => { events.push({ type, payload }); },
    } as any, { id: 'node-1', type: 'agent_output', config: {} }, {
      schemaVersion: 'agent-run-spec/v1', workflowId: 'workflow-1', workflowVersion: 'v1', runId: 'run-1', nodeId: 'node-1',
      task: { name: 'report', goal: 'create report', instruction: '' },
      target: { provider: 'client_local', kind: 'agent_output', model: 'test' },
      inputs: {}, allowedSkills: [], allowedTools: [], outputSchema: '', metadata: {},
      runtimeContext: { startup: { schema: {}, resolvedInputs: {} }, isFirstAgentNode: true, workspacePath: workspace },
      permissionPolicy: { mode: 'workspace_write' }, limits: {},
      completionContract: { dataJsonSchema: { type: 'object' }, outputJsonSchema: { type: 'object' }, maxAttempts: 1, onIncomplete: 'retry' },
      prompt: '',
    }, {
      execEngine,
      quota: async () => true,
      invokeAgent: async () => ({ status: 'succeeded', rawText: JSON.stringify(draft), output }),
    });

    expect(result.status).toBe('succeeded');
    expect(result.output.artifacts[0]).toMatchObject({ resourceId: 'report.md', kind: 'OUTPUT' });
    expect(result.output.artifacts[0]).not.toHaveProperty('checksum');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'completion.output_normalized',
      payload: expect.objectContaining({ reason: 'artifact_host_metadata_stripped' }),
    }));
  });
});
