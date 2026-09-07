import { Button, Result, Spin } from 'antd';

export function RuntimeBootstrapShell({ error }: { error?: string }) {
  if (!error) {
    return (
      <div className="runtime-bootstrap-shell">
        <Spin size="large" tip="正在启动应用..." />
      </div>
    );
  }

  return (
    <div className="runtime-bootstrap-shell">
      <Result
        status="error"
        title="应用启动失败"
        subTitle={error}
        extra={(
          <Button type="primary" onClick={() => window.location.reload()}>
            重新加载
          </Button>
        )}
      />
    </div>
  );
}
