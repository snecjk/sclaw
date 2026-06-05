import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { registerAgentTelemetry } from "./register-hooks.js";

export default definePluginEntry({
  id: "sto-agent-telemetry",
  name: "申通 Agent 全链路遥测",
  description: "将 OpenClaw Agent 工具/模型 hook 事件上报至 memory-center（sto.agent.telemetry/v1）",
  register(api: OpenClawPluginApi) {
    registerAgentTelemetry(api);
  },
});
