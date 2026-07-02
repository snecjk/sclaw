import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import {
  DISTINCTIVE_DESIGN_ROUTING_PROMPT,
  evaluateBeforeHtmlWrite,
  formatLintFailureMessage,
  noteSkillUsageFromToolPayload,
  runDistinctiveDesignLint,
  shouldLintAfterHtmlWrite,
} from "../../../openclaw/sto-distinctive-design-guard/guard-core.js";

export interface ClaudeRuntimeOptions {
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  systemPromptAppend?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

const HTML_WRITE_MATCHERS = ["Write", "Edit", "NotebookEdit"];

export function buildStoDistinctiveDesignGuardClaudeRuntimeOptions(
  sessionKey: string,
): ClaudeRuntimeOptions {
  const preToolHooks: HookCallbackMatcher[] = HTML_WRITE_MATCHERS.map((matcher) => ({
    matcher,
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PreToolUse") return {};

        noteSkillUsageFromToolPayload(sessionKey, sessionKey, input.tool_input);

        const decision = evaluateBeforeHtmlWrite({
          toolName: input.tool_name,
          params: asRecord(input.tool_input),
          sessionKey,
          sessionId: sessionKey,
        });

        if (!decision.allowed) {
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: decision.reason,
            },
          };
        }

        return {};
      },
    ],
  }));

  preToolHooks.push({
    matcher: "Bash",
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PreToolUse") return {};
        noteSkillUsageFromToolPayload(sessionKey, sessionKey, input.tool_input);
        return {};
      },
    ],
  });

  const postToolHooks: HookCallbackMatcher[] = HTML_WRITE_MATCHERS.map((matcher) => ({
    matcher,
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PostToolUse") return {};

        noteSkillUsageFromToolPayload(sessionKey, sessionKey, input.tool_input);

        const targetPath = shouldLintAfterHtmlWrite({
          toolName: input.tool_name,
          params: asRecord(input.tool_input),
          hasError: false,
        });

        if (!targetPath) return {};

        const lint = runDistinctiveDesignLint(targetPath);
        if (lint.skipped || lint.ok) return {};

        const message = formatLintFailureMessage(lint.output, targetPath);
        const existing =
          typeof input.tool_response === "string"
            ? input.tool_response
            : JSON.stringify(input.tool_response ?? "");

        return {
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: `${existing}\n\n${message}`,
          },
        };
      },
    ],
  }));

  return {
    systemPromptAppend: DISTINCTIVE_DESIGN_ROUTING_PROMPT,
    hooks: {
      PreToolUse: preToolHooks,
      PostToolUse: postToolHooks,
    },
  };
}
