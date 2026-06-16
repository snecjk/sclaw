/** 从 OpenClaw tool params 提取 CLI / sai-cli 命令文本（供 HM ingest 解析） */

const PARAM_KEYS = [
  "command",
  "cmd",
  "script",
  "input",
  "argv",
  "args",
  "program",
  "line",
  "shellCommand",
  "shell_command",
  "arguments",
  "request",
  "commandPath",
  "command_path",
  "path",
] as const;

const COMMAND_PATH_KEYS = ["commandPath", "command_path", "path"] as const;

const SAI_CLI_LAUNCHERS = new Set(["sai-cli", "sai_cli", "sai"]);

const SAI_META_COMMANDS = new Set([
  "help",
  "discover",
  "whoami",
  "login",
  "logout",
  "version",
  "refresh-cache",
  "refresh_cache",
  "list",
  "update",
  "upgrade",
  "install",
  "uninstall",
  "remove",
]);

function stripSaiCliPrefix(command: string): string {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  while (parts.length > 0) {
    const token = parts[0].toLowerCase().replace(/_/g, "-");
    if (!SAI_CLI_LAUNCHERS.has(token)) {
      break;
    }
    parts.shift();
  }
  return parts.join(" ");
}

/** Bash 中 `sai-cli finance bill query` → `finance bill query` */
function normalizeShellCommand(text: string): string {
  const stripped = stripSaiCliPrefix(text);
  const parts = stripped.split(/\s+/).filter(Boolean);
  if (parts.length >= 3 && !SAI_META_COMMANDS.has(parts[0].toLowerCase())) {
    return parts.slice(0, 3).join(" ");
  }
  return stripped;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function fromArgvLike(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const parts = value
    .map((item) => (typeof item === "string" ? item.trim() : item != null ? String(item).trim() : ""))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function fromProductModuleAction(obj: Record<string, unknown>): string | undefined {
  const product = asTrimmedString(obj.product);
  const module = asTrimmedString(obj.module);
  const action = asTrimmedString(obj.action);
  if (product && module && action) {
    return `${product} ${module} ${action}`;
  }
  return undefined;
}

/** sai-cli IPC / 工具入参：`finance/bill/query` → `finance bill query` */
export function fromCommandPath(value: unknown): string | undefined {
  const path = asTrimmedString(value);
  if (!path) {
    return undefined;
  }
  const segments = path.split(/[/\s]+/).filter(Boolean);
  if (segments.length >= 3) {
    return segments.slice(0, 3).join(" ");
  }
  return undefined;
}

function hintSegmentsFromParams(params: Record<string, unknown>): Record<string, string> {
  const hint: Record<string, string> = {};
  const pma = fromProductModuleAction(params);
  if (pma) {
    const [product, module, action] = pma.split(" ");
    hint.product = product;
    hint.module = module;
    hint.action = action;
    return hint;
  }
  for (const key of COMMAND_PATH_KEYS) {
    const path = asTrimmedString(params[key]);
    if (!path) continue;
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 3) {
      hint.product = segments[0];
      hint.module = segments[1];
      hint.action = segments[2];
      return hint;
    }
  }
  return hint;
}

function fromInputObject(input: Record<string, unknown>): string | undefined {
  for (const key of COMMAND_PATH_KEYS) {
    const fromPath = fromCommandPath(input[key]);
    if (fromPath) {
      return fromPath;
    }
  }
  const direct =
    asTrimmedString(input.command) ??
    asTrimmedString(input.cmd) ??
    asTrimmedString(input.script) ??
    asTrimmedString(input.line);
  if (direct) {
    return normalizeShellCommand(direct);
  }
  const argvText = fromArgvLike(input.argv) ?? fromArgvLike(input.args);
  if (argvText) {
    return normalizeShellCommand(argvText);
  }
  return fromProductModuleAction(input);
}

export function extractCommandText(params: Record<string, unknown> | undefined): string | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }

  for (const key of COMMAND_PATH_KEYS) {
    const fromPath = fromCommandPath(params[key]);
    if (fromPath) {
      return fromPath;
    }
  }

  const pma = fromProductModuleAction(params);
  if (pma) {
    return pma;
  }

  for (const key of PARAM_KEYS) {
    const value = params[key];
    if (key === "argv" || key === "args") {
      const argvText = fromArgvLike(value);
      if (argvText) {
        return normalizeShellCommand(argvText);
      }
      continue;
    }
    if (key === "input" || key === "arguments" || key === "request") {
      if (typeof value === "string") {
        const text = asTrimmedString(value);
        if (text) {
          return normalizeShellCommand(text);
        }
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = fromInputObject(value as Record<string, unknown>);
        if (nested) {
          return nested;
        }
      }
      continue;
    }
    const text = asTrimmedString(value);
    if (text) {
      if (key === "command" || key === "cmd" || key === "script" || key === "line" || key === "shellCommand" || key === "shell_command" || key === "program") {
        return normalizeShellCommand(text);
      }
      return text;
    }
  }

  return undefined;
}

/** 上报 HM 时保留的 params 白名单字段（脱敏前） */
export function pickCliParams(params: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const key of [...PARAM_KEYS, "product", "module", "action", "params"]) {
    if (key in params && params[key] != null) {
      out[key] = params[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildToolCommandPayload(event: {
  params?: Record<string, unknown>;
  command?: string;
}): { toolHint?: Record<string, string>; eventParams?: Record<string, unknown> } | undefined {
  const picked = pickCliParams(event.params);
  const direct = asTrimmedString(event.command);
  const fromParams = picked ? extractCommandText(picked) : undefined;
  const rawCommand = direct ?? fromParams;
  const command = rawCommand ? normalizeShellCommand(rawCommand) : undefined;
  if (!command && !picked) {
    return undefined;
  }
  const hint: Record<string, string> = {};
  if (command) {
    hint.command = command;
    const segments = command.split(/\s+/).filter(Boolean);
    if (segments.length >= 3) {
      hint.product = segments[0];
      hint.module = segments[1];
      hint.action = segments[2];
    }
  }
  if (picked) {
    Object.assign(hint, hintSegmentsFromParams(picked));
  }
  return {
    toolHint: Object.keys(hint).length > 0 ? hint : undefined,
    eventParams: picked ?? (command ? { command } : undefined),
  };
}
