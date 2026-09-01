import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImportedXmlComponent,
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
  throw new Error("Usage: node create-docx.js /absolute/path/output.docx");
}

const outputDir = path.dirname(outputPath);
fs.mkdirSync(outputDir, { recursive: true });

const T = String.raw;
const docTitle = T`应用广场 · 用户应用开发能力方案汇报`;
const palette = {
  dark: "263238",
  primary: "37474F",
  light: "78909C",
  border: "D8E0E3",
  fill: "EEF3F6",
};

const font = {
  ascii: "Times New Roman",
  hAnsi: "Times New Roman",
  cs: "Times New Roman",
  eastAsia: "SimSun",
};

const run = (text, options = {}) =>
  new TextRun({ text, font, size: 24, ...options });

const para = (children, options = {}) =>
  new Paragraph({
    spacing: { after: 140, line: 300 },
    ...options,
    children: Array.isArray(children) ? children : [children],
  });

const bodyPara = (text, options = {}) =>
  para(run(text), {
    indent: { firstLine: convertInchesToTwip(0.33) },
    ...options,
  });

const bullet = (text) =>
  para(run(text), {
    indent: { left: convertInchesToTwip(0.33), hanging: convertInchesToTwip(0.18) },
    spacing: { after: 80, line: 300 },
  });

const heading = (text, level = 1) =>
  para(run(text, { bold: true, size: level === 1 ? 30 : 26, color: palette.dark }), {
    heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
  });

const cell = (text, options = {}) =>
  new TableCell({
    children: [para(run(text), { spacing: { after: 40, line: 260 } })],
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
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
            children: r.map((c, i) =>
              cell(c, { width: { size: widths[i], type: WidthType.DXA } }),
            ),
          }),
      ),
    ],
  });

const xmlEscape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const toc = (entries) => {
  const cached = entries
    .map(({ title: entryTitle, level, page }) => {
      const indent = Math.max(0, level - 1) * 360;
      return `<w:p>
        <w:pPr>
          <w:pStyle w:val="TOC${level}"/>
          <w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>
          <w:ind w:left="${indent}"/></w:pPr>
        <w:r><w:t>${xmlEscape(entryTitle)}</w:t></w:r>
        <w:r><w:tab/></w:r>
        <w:r><w:t>${xmlEscape(page)}</w:t></w:r>
      </w:p>`;
    })
    .join("");

  return ImportedXmlComponent.fromXmlString(`<w:sdt xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:sdtPr><w:alias w:val="目录"/></w:sdtPr>
    <w:sdtContent>
      <w:p>
        <w:r>
          <w:fldChar w:fldCharType="begin" w:dirty="true"/>
          <w:instrText xml:space="preserve"> TOC \\o &quot;1-3&quot; \\h \\z \\u </w:instrText>
          <w:fldChar w:fldCharType="separate"/>
        </w:r>
      </w:p>
      ${cached}
      <w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    </w:sdtContent>
  </w:sdt>`).root[0];
};

const sections = [
  {
    title: T`一、背景与目标`,
    level: 1,
    page: 2,
    paragraphs: [
      T`公司已沉淀一批基础业务接口。本方案的目标，是让业务人员（非专业开发者）在 SClaw 应用广场中，仅通过自然语言即可开发、上线自己的应用，把重复性的页面开发需求从研发侧释放出去。`,
      T`核心体验原则只有一条：用户只需要会"说话"。全程不出现代码、命令、提交、冲突等技术概念，只有"创建 / 对话 / 预览 / 保存并发布 / 恢复上一版"。`,
      T`关键衡量指标：新用户从点击"创建"到看到第一个可运行页面不超过 3 分钟（含运行环境自动准备）；对话改动秒级生效；改坏可一键恢复。`,
    ],
  },
  {
    title: T`二、方案总览：一条用户旅程`,
    level: 1,
    page: 2,
    paragraphs: [
      T`用户视角只有四个动作，其余全部由系统与 AI 在后台完成：`,
    ],
    table: () =>
      makeTable(
        [1600, 3400, 4400],
        [T`环节`, T`用户做什么`, T`系统与 AI 做什么`],
        [
          [T`创建应用`, T`填名称、选类型、选目录`, T`工程模板初始化、运行环境自动准备、代码仓库自动建仓`],
          [T`对话开发`, T`用自然语言描述需求`, T`AI 生成页面、所见即所得实时预览、报错自动修复、每轮自动留存版本快照`],
          [T`数据查询`, T`说"帮我查 XX 数据"`, T`AI 自动选择对应 CLI、调用公司业务接口、把数据渲染进页面`],
          [T`提交发布`, T`点"保存并发布"`, T`自动提交并推送代码、对接公司发布流水线、发布状态实时可见`],
        ],
      ),
  },
  {
    title: T`三、如何创建应用：本地工程与 Git 仓库一站完成`,
    level: 1,
    page: 3,
    paragraphs: [],
  },
  {
    title: T`3.1 本地工程化项目`,
    level: 2,
    page: 3,
    paragraphs: [
      T`一步式创建向导（名称 + 类型 + 存放目录），从官方工程模板初始化项目：前端采用 React + Vite，与公司组件库、发布平台构建约定完全对齐；后端（FastAPI）按需开放。`,
      T`运行环境全托管：Node / Python 运行时由客户端静默下载、私有目录解压即用，依赖统一走公司内网镜像。用户无需安装任何开发环境，也不改动系统配置——这是"业务人员能用"的前提。`,
      T`模板内置公司接口文档与组件库用法说明，作为 AI 的固定知识库，从源头保证 AI 生成代码符合公司规范。`,
    ],
  },
  {
    title: T`3.2 Git 仓库：用户零感知`,
    level: 2,
    page: 3,
    paragraphs: [
      T`创建应用时自动在公司代码托管平台建仓（通过 sto-app CLI），此后每一轮 AI 改动自动形成版本快照，后台静默同步。`,
      T`用户全程不接触任何 Git 概念；误操作可"恢复上一版"；换电脑或误删目录，可从云端一键拉回恢复。凭证一次粘贴、长期托管，到期主动提醒。`,
    ],
  },
  {
    title: T`四、AI 如何开发页面：工程化模板 + A2UI`,
    level: 1,
    page: 4,
    paragraphs: [],
  },
  {
    title: T`4.1 模板设计：让 AI "有边界地创作"`,
    level: 2,
    page: 4,
    paragraphs: [
      T`模板把工程分为两层：页面是结构化数据资产（AI 的主战场，只改这里），平台壳（渲染器、布局、请求封装）锁定不可改。组件走白名单目录（Catalog），查询、表格、分页等高频场景均有公司标准组件直接可用。`,
      T`这一设计的直接收益：AI 出错率低、生成速度快（token 消耗省）、产物质量稳定，且每一版都可回滚。`,
    ],
  },
  {
    title: T`4.2 A2UI / AG-UI 的作用与优势`,
    level: 2,
    page: 4,
    paragraphs: [
      T`A2UI 是声明式 UI 协议：AI 输出的是"页面描述"而非自由代码，由官方渲染器渲染成界面。带来的优势是安全可控（AI 不能写出危险代码）、天然可预览（说完即所见）、与行业开源标准对齐（避免自研渲染器的长期维护成本）。`,
      T`AG-UI 是 AI 与界面之间的标准会话通道，为后续"页面与 AI 双向互动"（如页面内嵌 AI 助手、表单智能填充）预留能力，按需启用，不阻塞当前闭环。`,
      T`关键取舍：我们放弃了自研渲染协议，选择成熟开源标准，把自研精力集中在公司组件封装与工程治理上——这是决定长期维护成本的核心决策。`,
    ],
  },
  {
    title: T`五、自然语言驱动 CLI，完成页面数据查询`,
    level: 1,
    page: 5,
    paragraphs: [
      T`公司业务接口统一封装为 CLI 工具（如 sai-cli），并把"什么场景用哪条命令"沉淀为 AI 技能。用户说"帮我查本月结算数据"，AI 自动完成三步：选择对应 CLI 命令 → 调用接口取数 → 把结构化数据渲染进页面。`,
      T`这一模式的优势：接口的权限控制与审计沿用 CLI 既有体系，安全合规；新增业务能力只需发布新的 CLI 命令与技能说明，客户端零改动、即时生效；页面通过契约（actionId）调用数据，不写死接口地址，前后端解耦。`,
    ],
  },
  {
    title: T`六、提交与发布构建`,
    level: 1,
    page: 5,
    paragraphs: [
      T`"保存并发布"一键完成三件事：自动提交代码 → 推送至公司代码仓库 → 进入公司基于 Git 的发布流水线。构建产物与发布平台约定完全一致，无需任何额外适配。`,
      T`发布全程状态可视化（创建迭代、同步代码、流水线构建、成功/失败），失败信息自动回流给 AI 诊断修复，用户看到的只是"发布中 / 发布成功"。`,
      T`代码提交前自动拉取，出现冲突先由 AI 自动处理，无法自动处理时给业务用户"保留我的 / 用云端的"二选一，不暴露任何技术细节。`,
    ],
  },
  {
    title: T`七、价值与收益`,
    level: 1,
    page: 6,
    paragraphs: [],
    table: () =>
      makeTable(
        [2000, 7400],
        [T`对象`, T`收益`],
        [
          [T`业务人员`, T`零门槛自助开发，想法分钟级变成可用应用，不再排队等研发排期`],
          [T`研发团队`, T`从重复页面开发中解放，专注平台、接口与组件库建设`],
          [T`公司`, T`接口与组件资产复用率提升；所有应用统一沉淀在代码托管与发布体系内，安全、合规、可审计`],
        ],
      ),
  },
  {
    title: T`八、分期规划与风险应对`,
    level: 1,
    page: 6,
    paragraphs: [
      T`按"本地优先、逐期解耦"推进：MVP（本地闭环：创建、对话开发、实时预览、版本回滚）→ P1（云端建仓同步、保存并发布、换机恢复）→ P2（后端能力、全栈应用）→ P3（广场生态、一键部署）。每一期独立可验证、可回滚。`,
      T`三个主要风险已有对策：首次环境准备耗时——后台预热加连续进度条，用户无感；AI 生成不规范——模板边界约束加接口文档注入，从源头约束；离线或外网场景——本地优先架构，远端操作全部异步重试，本地开发不受影响。`,
    ],
  },
];

const children = [
  para(run(docTitle, { bold: true, size: 40, color: palette.dark }), {
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { before: 2400, after: 240 },
  }),
  para(run(T`SClaw 客户端 · 应用广场 | 2026 年 8 月`, { color: palette.light }), {
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }),
  para(run(T`让业务人员用自然语言开发自己的应用`, { color: palette.light, italics: true }), {
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
  }),
  new Paragraph({ children: [], pageBreakBefore: true }),
  para(run(T`目录`, { bold: true, size: 30, color: palette.dark }), {
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
  }),
  para(run(T`右键目录，选择"更新域"刷新页码。`, { italics: true, color: palette.light })),
  toc(sections.map(({ title: t2, level, page }) => ({ title: t2, level, page }))),
  new Paragraph({ children: [], pageBreakBefore: true }),
];

for (const section of sections) {
  children.push(heading(section.title, section.level));
  for (const paragraph of section.paragraphs) {
    children.push(bodyPara(paragraph));
  }
  if (section.table) {
    children.push(section.table());
  }
}

const doc = new Document({
  features: { updateFields: true },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
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

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outputPath, buffer);
