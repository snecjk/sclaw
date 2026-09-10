import { Button } from 'antd';

const FEATURES = [
  { icon: '1', title: '业务页面', desc: '用自然语言描述需求，生成列表、表单与看板。' },
  { icon: '2', title: '设计一致', desc: '颜色、间距、圆角全部走主题 token，避免硬编码。' },
  { icon: '3', title: '本地预览', desc: '改完即时预览，支持桌面与手机视口切换。' },
] as const;

export function HomePage() {
  return (
    <div className="home-baseline">
      <section className="home-baseline-hero">
        <h1>欢迎使用业务应用骨架</h1>
        <p>
          这是一份可直接仿写的起始页：清晰层级、主题色按钮与三列卖点卡。
          请用对话描述你的业务页面，我会在此设计规范上扩展。
        </p>
        <Button type="primary" size="large">
          开始描述需求
        </Button>
      </section>

      <section className="home-baseline-features" aria-label="能力卖点">
        {FEATURES.map((item) => (
          <article key={item.title} className="home-baseline-card">
            <span className="home-baseline-card-icon" aria-hidden>
              {item.icon}
            </span>
            <h3>{item.title}</h3>
            <p>{item.desc}</p>
          </article>
        ))}
      </section>

      <footer className="home-baseline-footer">
        设计规范实例 · 字阶 / 间距 / 圆角 / 阴影均来自 theme.css token
      </footer>
    </div>
  );
}
