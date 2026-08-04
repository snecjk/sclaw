import { definePluginEntry, type OpenClawPluginApi } from './api.js';
import {
  evaluateConnectorToolCall,
  type ConnectorAllowlistEntry,
} from './shared/connectors/bash-gate.js';
import { loadConnectorAllowlistFromFile } from './shared/connectors/load-allowlist-file.js';
import { loadConnectorGatedBinariesFromFile } from './shared/connectors/load-gated-binaries-file.js';

const TAG = 'sto-connectors-bash-gate';

export default definePluginEntry({
  id: 'sto-connectors-bash-gate',
  name: 'StoClaw 连接器 CLI 门禁',
  description: '未连接连接器时拦截 exec/bash 中的受管 CLI，引导用户去连接器页面绑定',
  register(api: OpenClawPluginApi) {
    api.logger.info?.(`[${TAG}] plugin registering`);

    api.on(
      'before_tool_call',
      async (event) => {
        const allowlist = loadConnectorAllowlistFromFile() as ConnectorAllowlistEntry[];
        const gatedBinaries = loadConnectorGatedBinariesFromFile();
        const decision = evaluateConnectorToolCall(
          event.toolName,
          (event.params ?? {}) as Record<string, unknown>,
          allowlist,
          { gatedBinaries },
        );
        if (decision.blocked) {
          api.logger.info?.(
            `[${TAG}] blocked tool=${event.toolName} reason=${decision.reason.slice(0, 120)}`,
          );
          return {
            block: true,
            blockReason: decision.reason,
          };
        }
      },
      { priority: 110 },
    );

    api.logger.info?.(`[${TAG}] plugin registered successfully`);
  },
});
