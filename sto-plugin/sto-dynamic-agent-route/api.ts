import { requireOpenClawPluginSdk } from "./openclaw-sdk.js";

const core = requireOpenClawPluginSdk<typeof import("openclaw/plugin-sdk/core")>("core");
const providerAuth =
	requireOpenClawPluginSdk<typeof import("openclaw/plugin-sdk/provider-auth")>("provider-auth");

export const definePluginEntry = core.definePluginEntry;
export const createProviderApiKeyAuthMethod = providerAuth.createProviderApiKeyAuthMethod;
export type { OpenClawPluginApi, ProviderCatalogContext, ProviderCatalogResult } from "openclaw/plugin-sdk/core";
