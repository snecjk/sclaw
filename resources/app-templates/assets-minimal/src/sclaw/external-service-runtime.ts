import manifestJson from '../../contracts/external-services.v1.json';

type DeployEnv = 'daily' | 'stage' | 'online';
type Binding = {
  alias: string;
  environments: Record<DeployEnv, string>;
  auth: { type: 'none' | 'stoToken' };
};
type Manifest = { schemaVersion: 'external-services/v1'; services: Binding[] };
type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: unknown;
  body?: BodyInit | null;
  headers?: HeadersInit;
  params?: Record<string, string | number | boolean | null | undefined>;
  stoToken?: string | null;
  [key: string]: unknown;
};
type RequestInput = Omit<RequestOptions, 'method'> & { method?: RequestOptions['method']; path: string };
type RequestImpl = <T>(url: string, options?: RequestOptions) => Promise<T>;
type TestDependencies = { manifest?: Manifest; isDev?: boolean; request?: RequestImpl };

const defaultRequest: RequestImpl = async <T>(url: string, options?: RequestOptions) => {
  const { request } = await import('../lib/request');
  return request<T>(url, options);
};

function deployEnv(isDev: boolean): DeployEnv {
  if (isDev) return 'daily';
  const env = (window as unknown as { __SCLAW_APP_CONFIG__?: { deployEnv?: unknown } })
    .__SCLAW_APP_CONFIG__?.deployEnv;
  if (env !== 'daily' && env !== 'stage' && env !== 'online') {
    throw new Error('Assets 发布环境需由宿主注入');
  }
  return env;
}

export function createExternalServiceClient(alias: string, testDependencies: TestDependencies = {}) {
  const manifest = testDependencies.manifest ?? manifestJson as Manifest;
  const isDev = testDependencies.isDev ?? import.meta.env.DEV;
  const requestImpl = testDependencies.request ?? defaultRequest;
  const binding = manifest.services.find((item) => item.alias === alias);
  if (!binding) throw new Error(`外部服务绑定不存在：${alias}`);
  return {
    async request<T = unknown>({ path, ...options }: RequestInput): Promise<T> {
      if (!path.startsWith('/') || /^\/\//.test(path) || /^[a-z]+:/i.test(path)) {
        throw new Error('外部服务 path 必须是以 / 开头的相对路径');
      }
      const env = deployEnv(isDev);
      const url = isDev
        ? `/proxy/${encodeURIComponent(alias)}${path}`
        : `${binding.environments[env].replace(/\/$/, '')}${path}`;
      return requestImpl<T>(url, {
        ...options,
        ...(binding.auth.type === 'none'
          ? { stoToken: null }
          : { withCredentials: false }),
      });
    },
  };
}
