import {
  Card,
  Col,
  Row,
  Statistic,
  Typography,
  Space,
  Button,
  Alert,
  theme,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { getStoToken, getUserDisplayFromToken } from '../lib/auth-token';
import { toRoutePath } from '../layouts/nav-config';

export function HomePage() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const user = getUserDisplayFromToken();
  const hasToken = Boolean(getStoToken());

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          欢迎使用 __APP_TITLE__
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          标准 PC 三栏布局：顶部一级导航、左侧二级导航、右侧业务正文。已内置 antd 与请求封装。
        </Typography.Paragraph>
      </div>

      {!hasToken ? (
        <Alert
          type="info"
          showIcon
          message="尚未登录"
          description="应用会在启动时检查 cookie 中的 stoToken；未登录将跳转 SSO。SClaw 预览也可在链接上携带 ?stoToken=xxx 注入登录态。"
        />
      ) : (
        <Alert
          type="success"
          showIcon
          message={`已识别登录态：${user.name}${user.code ? `（${user.code}）` : ''}`}
          description="后续 request / http.* 调用会自动附带 stoToken 请求头，并默认 credentials: include。"
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="今日待办" value={8} valueStyle={{ color: token.colorPrimary }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="进行中任务" value={3} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="本周完成" value={26} suffix="项" />
          </Card>
        </Col>
      </Row>

      <Card title="快速开始" bordered={false}>
        <Space wrap>
          <Button type="primary" onClick={() => navigate(toRoutePath('demo'))}>
            查看组件示例
          </Button>
          <Button onClick={() => navigate(toRoutePath('orders'))}>进入业务列表</Button>
          <Button onClick={() => navigate(toRoutePath('profile'))}>个人中心</Button>
        </Space>
      </Card>
    </Space>
  );
}
