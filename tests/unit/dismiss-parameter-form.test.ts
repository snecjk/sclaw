import { beforeEach, describe, expect, it } from 'vitest';
import {
  dismissParameterFormInChat,
  dismissWorkflowParameterFormsForTemplate,
} from '../../src/components/parameter-form/dismiss-parameter-form';
import { registerParameterFormHandler } from '../../src/components/parameter-form/form-handlers';
import { useChatStore } from '../../src/stores/chat';
import { getSessionDisplayMessages } from '../../src/stores/chat/display-selectors';
import { useChatRuntimeV2Store } from '../../src/stores/chat/runtime-v2-store';
import type { ContentBlock } from '../../src/stores/chat';

function resetChat(messages: import('../../src/stores/chat').RawMessage[] = []) {
  useChatStore.setState({
    currentSessionKey: 'agent:test:main',
  });
  useChatRuntimeV2Store.getState().clearSession('agent:test:main');
  useChatRuntimeV2Store.getState().setDisplayProjection('agent:test:main', messages);
}

describe('dismiss-parameter-form', () => {
  beforeEach(() => {
    resetChat();
  });

  it('removes native parameter_form block after submit dismiss', () => {
    const formId = 'workflow-form-tpl-abc-1718000000000';
    resetChat([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '请确认参数' },
          {
            type: 'parameter_form',
            formId,
            formConfig: { id: formId, title: '参数', steps: [] },
            formContext: { source: 'workflow', sourceId: 'tpl-abc', schemaHash: 'h1' },
          },
        ] as ContentBlock[],
        id: 'm1',
      },
    ]);

    registerParameterFormHandler(formId, () => {});
    dismissParameterFormInChat(formId);

    const content = getSessionDisplayMessages('agent:test:main')[0].content as ContentBlock[];
    expect(content.some((b) => b.type === 'parameter_form')).toBe(false);
    expect((content[0] as { text?: string }).text).toBe('请确认参数');
  });

  it('removes ParameterForm marker from assistant text', () => {
    resetChat([
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '请确认参数<ParameterForm templateId="tpl-abc" schemaHash="h1" />',
          },
        ] as ContentBlock[],
        id: 'm1',
      },
    ]);

    dismissWorkflowParameterFormsForTemplate('tpl-abc');

    const content = getSessionDisplayMessages('agent:test:main')[0].content as ContentBlock[];
    expect((content[0] as { text?: string }).text).toBe('请确认参数');
  });
});
