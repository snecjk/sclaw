import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import {
  DISTINCTIVE_DESIGN_ROUTING_PROMPT,
  evaluateBeforeHtmlWrite,
  formatLintFailureMessage,
  noteSkillUsageFromToolPayload,
  runDistinctiveDesignLint,
  shouldLintAfterHtmlWrite,
} from "./guard-core.js";

const TAG = "sto-distinctive-design-guard";

type GuardPluginConfig = {
  enabled?: boolean;
  enforceRead?: boolean;
  lintEnabled?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function isGuardEnabled(config: GuardPluginConfig): boolean {
  return config.enabled !== false;
}

export default definePluginEntry({
  id: "sto-distinctive-design-guard",
  name: "STO Distinctive Design Guard",
  description: "Route HTML deliverables through sto-distinctive-design skill",
  register(api: OpenClawPluginApi) {
    const pluginCfg = (api.pluginConfig ?? {}) as GuardPluginConfig;
    const enforceRead = pluginCfg.enforceRead !== false;
    const lintEnabled = pluginCfg.lintEnabled !== false;

    if (!isGuardEnabled(pluginCfg)) {
      api.logger.info?.(`[${TAG}] plugin disabled via config`);
      return;
    }

    api.logger.info?.(
      `[${TAG}] plugin registering — enforceRead=${enforceRead}, lintEnabled=${lintEnabled}`,
    );

    api.on("before_prompt_build", async () => ({
      appendSystemContext: DISTINCTIVE_DESIGN_ROUTING_PROMPT,
    }));

    api.on(
      "before_tool_call",
      (event, ctx) => {
        noteSkillUsageFromToolPayload(ctx.sessionKey, ctx.sessionId, event);

        if (!enforceRead) {
          return;
        }

        const params = asRecord(event.params);
        const decision = evaluateBeforeHtmlWrite({
          toolName: event.toolName,
          params,
          sessionKey: ctx.sessionKey,
          sessionId: ctx.sessionId,
        });

        if (!decision.allowed) {
          api.logger.warn?.(
            `[${TAG}] blocked tool=${event.toolName} sessionKey=${ctx.sessionKey ?? "-"}: HTML write without sto-distinctive-design`,
          );
          return {
            block: true,
            blockReason: decision.reason,
          };
        }
      },
      { priority: 90 },
    );

    api.on("after_tool_call", (event, ctx) => {
      const record = event as Record<string, unknown>;
      noteSkillUsageFromToolPayload(ctx.sessionKey, ctx.sessionId, event);

      if (!lintEnabled) {
        return;
      }

      const params = asRecord(event.params) ?? asRecord(record.params);
      const targetPath = shouldLintAfterHtmlWrite({
        toolName: typeof event.toolName === "string" ? event.toolName : "",
        params,
        hasError: Boolean(event.error),
      });

      if (!targetPath) {
        return;
      }

      const lint = runDistinctiveDesignLint(targetPath);
      if (lint.skipped) {
        api.logger.debug?.(`[${TAG}] lint skipped for ${targetPath}: ${lint.output}`);
        return;
      }

      if (lint.ok) {
        api.logger.info?.(`[${TAG}] lint passed for ${targetPath}`);
        return;
      }

      const message = formatLintFailureMessage(lint.output, targetPath);
      api.logger.warn?.(`[${TAG}] lint failed (exit=${lint.exitCode}) for ${targetPath}`);

      return {
        toolResultAppend: message,
        appendToolOutput: message,
      };
    });

    api.logger.info?.(`[${TAG}] plugin registered successfully`);
  },
});
