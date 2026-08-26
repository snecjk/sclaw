import { Button, Result, Spin } from 'antd';
import { redirectToSsoLogin } from '../lib/sso';

export function SsoExchangeLoading() {
  return (
    <div className="sso-auth-shell">
      <Spin size="large" tip="正在完成登录..." />
    </div>
  );
}

export function SsoExchangeError({ message }: { message: string }) {
  return (
    <div className="sso-auth-shell">
      <Result
        status="error"
        title="登录失败"
        subTitle={message}
        extra={(
          <Button type="primary" onClick={() => redirectToSsoLogin()}>
            重新登录
          </Button>
        )}
      />
    </div>
  );
}
