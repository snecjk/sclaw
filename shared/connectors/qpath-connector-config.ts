/**
 * Canonical QPath connector runtime/agent config (new-product style).
 * Copy into Connector Admin; client must not hardcode these URLs for happy path.
 */
import { QPATH_AUTH_PATTERNS } from './auth-pattern-presets';

export const QPATH_CONNECTOR_RUNTIME = {
  binary: 'qpath',
  install: {
    strategy: 'shell_script' as const,
    unix: 'https://operation-pmai.sto.cn/api/qpath-cli/prod/install',
    windows: 'https://operation-pmai.sto.cn/api/qpath-cli/prod/install.cmd',
    binDir: '~/.sto/qpath-cli/bin',
  },
  auth: {
    type: 'cli_login' as const,
    ui: 'open_url' as const,
    openIn: 'embedded' as const,
    hint: '请在弹窗中完成钉钉登录',
    login: ['qpath', 'login'],
    status: ['qpath', 'status'],
    logout: ['qpath', 'logout'],
    loginUrlPattern: QPATH_AUTH_PATTERNS.loginUrlPattern,
    loggedInPattern: QPATH_AUTH_PATTERNS.loggedInPattern,
    loggedOutPattern: QPATH_AUTH_PATTERNS.loggedOutPattern,
    authExpiredPattern: QPATH_AUTH_PATTERNS.authExpiredPattern,
  },
  gateway: {
    allowBinary: 'qpath',
    denyArgs: ['upgrade', 'install', 'uninstall'],
  },
};

export const QPATH_CONNECTOR_AGENT = {
  readyWhen: 'connected',
  summary: '项目管理：需求、任务、迭代等，连接后可在对话中自然语言操作',
  examples: ['查一下我的 QPath 任务', '创建一个迭代并列出需求'],
  skill: {
    slug: 'qpath-cli-commands',
    scope: 'connector' as const,
    source: 'package' as const,
    packageUrl:
      'https://gitlab.sto.cn/pm-ai-public/qpath-cli-skill/-/archive/main/archive.tar.gz',
  },
};
