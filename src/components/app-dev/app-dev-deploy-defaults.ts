/**
 * Temporary placeholder server credentials for cloud upload forms.
 * Replace with real config / secrets store when devops integration lands.
 */
export interface AppDevServerFormValues {
  host: string;
  port: string;
  username: string;
  password: string;
  remotePath: string;
}

export const DEFAULT_FRONTEND_SERVER: AppDevServerFormValues = {
  host: '192.168.10.88',
  port: '22',
  username: 'deploy',
  password: 'Demo@123456',
  remotePath: '/var/www/app-frontend',
};

export const DEFAULT_BACKEND_SERVER: AppDevServerFormValues = {
  host: '192.168.10.89',
  port: '22',
  username: 'deploy',
  password: 'Demo@123456',
  remotePath: '/opt/app-backend',
};

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
