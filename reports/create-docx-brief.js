import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from "docx";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("Usage: node create-docx-brief.js /absolute/path/output.docx");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const T = String.raw;
const docTitle = T`应用广场 · 用户应用开发 周会同步（进度 + 方案）`;
const palette = { dark: "263238", primary: "37474F", light: "78909C", fill: "EEF3F6" };

const font = {
  ascii: "Times New Roman",
  hAnsi: "Times New Roman",
  cs: "Times New Roman",
  eastAsia: "SimSun",
};

const run = (text, options = {}) => new TextRun({ text, font, size: 24, ...options });
const para = (children, options = {}) =>
  new Paragraph({
    spacing: { after: 100, line: 300 },
    ...options,
    children: Array.isArray(children) ? children : [children],
  });
const bodyPara = (text) =>
  para(run(text), { indent: { firstLine: convertInchesToTwip(0.33) } });
const heading = (text) =>
  para(run(text, { bold: true, size: 28, color: palette.dark }), {
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 200, after: 90 },
  });
const cell = (text, options = {}) =>
  new TableCell({
    children: [para(run(text), { spacing: { after: 30, line: 260 } })],
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    ...options,
  });

const makeTable = (widths, header, rows) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: [
      new TableRow({
        children: header.map((h, i) =>
          cell(h, {
            shading: { type: ShadingType.CLEAR, fill: palette.fill },
            width: { size: widths[i], type: WidthType.DXA },
          }),
        ),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c, i) => cell(c, { width: { size: widths[i], type: WidthType.DXA } })),
          }),
      ),
    ],
  });

const children = [
  para(run(docTitle, { bold: true, size: 32, color: palette.dark }), {
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 100 },
  }),
  para(run(T`业务组周会 · 快速对齐 | 2026-08-04`, { color: palette.light }), {
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
  }),

  heading(T`一、当前进度`),
  makeTable(
    [2400, 1400, 5600],
    [T`能力`, T`状态`, T`说明`],
    [
      [T`第一步 创建应用`, T`已落地`, T`创建向导、Node 运行时托管、模板初始化、本地 checkpoint 回滚；sto-app 建仓与云端协作已接入`],
      [T`第二步 生成功能`, T`已切默认`, T`A2UI 模板为默认：页面 = page.json 数据资产、antd 组件白名单 Catalog、AI 上下文自动注入、对话 + 实时预览`],
      [T`第三步 发布应用`, T`进行中`, T`"保存并发布"打通 DevOps 流水线（P1）；部署与域名分配由 DevOps 平台承接`],
    ],
  ),
  bodyPara(T`总体目标：业务人员在应用广场里用自然语言走完"创建应用 → 生成功能 → 发布应用"三步，3 分钟内看到可运行页面，全程不接触代码与 Git。`),

  heading(T`二、第一步：创建应用（含 Git 仓库管理）`),
  bodyPara(T`一步式创建向导：填名称、选类型（前端 / 前端+后端）、选目录，从官方工程模板（React + Vite，对齐公司组件库与发布平台构建约定）一步初始化。`),
  bodyPara(T`环境全托管：Node / Python 运行时由客户端静默下载、私有目录解压即用，依赖统一走公司内网镜像（snpm / PyPI 镜像）；用户机器零安装，也不改系统配置。`),
  bodyPara(T`Git 仓库管理：创建时经 sto-app CLI 自动建仓；此后每轮 AI 改动自动 commit 形成版本快照，后台静默 push/pull；云端应用清单为权威来源，换机或误删可克隆恢复；冲突先由 AI 自动处理，兜底给用户"保留我的 / 用云端的"二选一。用户全程零 Git 概念。`),

  heading(T`三、第二步：生成功能（AI 编排页面）`),
  bodyPara(T`页面即数据资产：AI 输出的是结构化页面描述（A2UI page.json），只改页面与契约；渲染器、布局、请求封装等平台壳锁定不可改——这是质量稳定与可回滚的关键。`),
  bodyPara(T`为什么用 A2UI / AG-UI：A2UI 是开源声明式 UI 协议，AI 写"页面描述"而非自由代码，由官方渲染器渲染——安全可控、天然可预览（对话改动秒级生效）、零自研协议的长期维护成本；AG-UI 是 AI 与界面的标准会话通道，为"页面内 AI 互动"预留，按需启用。我们放弃了自研渲染协议，自研精力集中在组件封装与工程治理上。`),
  bodyPara(T`组件库内置：模板预装 antd 白名单 Catalog（AntdFilterBar 查询栏 / AntdTable 表格 / AntdPagination 分页等），高频场景直接用公司标准件；公司接口文档随模板注入为 AI 固定上下文。`),
  bodyPara(T`未来如何丰富组件库：Catalog 可持续封装 antd / 公司 STO 组件（白名单属性收敛，防止 AI 误用）；配套"社区选装包"机制——安装一个包 = 装依赖 + 装 AI 用法技能（skill），装完 AI 即会用；组件库统一从 snpm 发布，模板迭代不依赖客户端发版。`),
  bodyPara(T`页面数据查询：业务接口封装为 CLI（sai-cli 等）+ AI 技能，自然语言 → 选命令 → 取数 → 渲染；页面经契约（actionId）取数不写死地址；接口权限与审计沿用 CLI 体系，新增业务能力客户端零改动。`),

  heading(T`四、第三步：发布应用（对接 DevOps 平台）`),
  bodyPara(T`"保存并发布"一键完成：自动提交 → 推送代码仓库 → 进入公司基于 Git 的 DevOps 发布流水线；构建产物与发布平台约定完全一致（npm run build 输出 build/），零适配。`),
  bodyPara(T`发布全程状态可视化：创建迭代 → 同步代码 → 流水线构建 → 成功 / 失败，失败信息自动回流 AI 诊断修复，用户只看到"发布中 / 发布成功"。`),
  bodyPara(T`部署与域名分配：由 DevOps 平台侧承接（SClaw 交付到 Git 即完成）；后续（P3）支持在 SClaw 内用自然语言调用部署平台 API / CLI 触发部署、查看域名与访问地址，需 DevOps 平台团队配合开放接口。`),

  heading(T`五、下一步与需要业务组配合`),
  bodyPara(T`下一步：P1 云端同步与"保存并发布"全量放开 → P2 Python 后端全栈 → P3 广场上架分享、自然语言触发部署。`),
  bodyPara(T`需要业务组配合三件事：接口清单文档（md）维护——直接决定 AI 生成质量；业务 CLI 命令覆盖度与用法技能编写——决定自然语言取数成功率；试用反馈——创建体验、还缺哪些组件和接口，周会随时抛。`),
];

const doc = new Document({
  features: { updateFields: false },
  sections: [
    {
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
      },
      headers: {
        default: new Header({
          children: [
            para(run(docTitle, { bold: true, color: palette.primary }), {
              alignment: AlignmentType.CENTER,
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            para(new TextRun({ children: [PageNumber.CURRENT] }), {
              alignment: AlignmentType.CENTER,
            }),
          ],
        }),
      },
      children,
    },
  ],
});

fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
