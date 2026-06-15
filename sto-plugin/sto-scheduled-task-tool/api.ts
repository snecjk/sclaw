import { requireOpenClawPluginSdk } from "./openclaw-sdk.js";

const core = requireOpenClawPluginSdk<typeof import("openclaw/plugin-sdk/core")>("core");

export const definePluginEntry = core.definePluginEntry;
export type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
