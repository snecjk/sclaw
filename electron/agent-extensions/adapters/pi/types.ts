import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type {
  SclawExtensionBuildContext,
  SclawNativeContributionMode,
} from '../../../../shared/agent-extensions';

export interface PiNativeContribution {
  mode?: SclawNativeContributionMode;
  claims?: {
    tools?: readonly string[];
  };
  build(
    context: SclawExtensionBuildContext,
  ): Promise<InlineExtension | readonly InlineExtension[]> | InlineExtension | readonly InlineExtension[];
}
