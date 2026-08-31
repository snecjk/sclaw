import type { SclawToolPolicy } from '../../../../shared/agent-extensions';
import { STO_DINGTALK_SEND_GUARD_CAPABILITY } from './capability';
import {
  DINGTALK_NO_BYPASS_HINT,
  classifyDingTalkSend,
  containsDingTalkSend,
  isDingTalkSendDryRun,
  normalizeDingTalkSendInput,
  parseDingTalkSendFingerprint,
  readDingTalkToolCommand,
  resolveDingTalkSendStaticProblem,
} from './command';
import { isSuccessfulDingTalkSend } from './result';

export const dingTalkSendPolicy: SclawToolPolicy = {
  id: 'dingtalk-send-guard',
  async beforeTool(event, context) {
    if (event.toolKind !== 'shell') return { action: 'allow' };
    const command = readDingTalkToolCommand(event.input);
    if (!containsDingTalkSend(command)) return { action: 'allow' };

    const staticProblem = resolveDingTalkSendStaticProblem(command);
    if (staticProblem) {
      context.logger.warn('[agent-extension] dingtalk.send.denied', {
        engine: context.engine,
        extensionId: 'sto-dingtalk-send-guard',
        toolCallId: event.toolCallId,
        decisionCode: 'static-policy',
      });
      return { action: 'deny', reason: `${staticProblem} ${DINGTALK_NO_BYPASS_HINT}` };
    }

    const normalizedInput = normalizeDingTalkSendInput(
      event.input,
      context.commandShell,
    );
    const normalizedCommand = readDingTalkToolCommand(normalizedInput);
    const category = classifyDingTalkSend(normalizedCommand);
    if (category && !isDingTalkSendDryRun(normalizedCommand)) {
      const fingerprint = parseDingTalkSendFingerprint(normalizedCommand);
      const reservation = await context.capabilities
        .require(STO_DINGTALK_SEND_GUARD_CAPABILITY)
        .reserveSend({
          sessionKey: context.sessionKey,
          toolCallId: event.toolCallId,
          category,
          recipientKey: fingerprint.recipientKey,
          normalizedText: fingerprint.normalizedText,
          scheduledExecution: context.mode === 'scheduled',
        });
      if (!reservation.allowed) {
        context.logger.warn('[agent-extension] dingtalk.send.denied', {
          engine: context.engine,
          extensionId: 'sto-dingtalk-send-guard',
          toolCallId: event.toolCallId,
          category,
          decisionCode: reservation.code,
        });
        return { action: 'deny', reason: `${reservation.reason} ${DINGTALK_NO_BYPASS_HINT}` };
      }
      context.state.toolCall(event.toolCallId).set('reserved', true);
    }

    if (normalizedInput !== event.input) {
      context.logger.debug('[agent-extension] dingtalk.send.patched', {
        engine: context.engine,
        extensionId: 'sto-dingtalk-send-guard',
        toolCallId: event.toolCallId,
        category,
      });
      return { action: 'patch', input: normalizedInput };
    }
    return { action: 'allow' };
  },
  async afterTool(event, context) {
    if (!context.state.toolCall(event.toolCallId).get<boolean>('reserved')) return;
    const success = isSuccessfulDingTalkSend(
      event.isError,
      event.details ?? event.result ?? event.content,
    );
    await context.capabilities.require(STO_DINGTALK_SEND_GUARD_CAPABILITY).completeSend({
      sessionKey: context.sessionKey,
      toolCallId: event.toolCallId,
      success,
    });
    context.logger.info('[agent-extension] dingtalk.send.completed', {
      engine: context.engine,
      extensionId: 'sto-dingtalk-send-guard',
      toolCallId: event.toolCallId,
      success,
    });
  },
};
