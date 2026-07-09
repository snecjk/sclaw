## ADDED Requirements

### Requirement: 从本地 ZIP 文件或文件夹上传技能
系统 SHALL 允许用户从技能广场上传包含技能包的本地 ZIP 文件或文件夹;上传的文件夹或 .zip 须包含 SKILL.md(YAML frontmatter 格式,含 `name` 与 `description` 字段)。上传入口 SHALL 是技能广场页面头部的一个按钮,点击后弹出应用内模态弹窗;弹窗 SHALL 提供拖拽区(接受文件夹与 .zip 文件)与"选择文件/文件夹"入口。

#### Scenario: 用户拖拽或选择有效的 ZIP 文件
- **WHEN** 用户将一个包含 SKILL.md(name 字段有效)的 .zip 文件拖入弹窗拖拽区,或通过选择入口选中该 ZIP
- **THEN** 系统解压 ZIP,从 SKILL.md frontmatter 读取 name 字段作为 slug,将技能安装到 ~/.stoclaw/openclaw/skills/<slug>/,写入 .stoclaw-user-upload.json 标记文件,同步到用户 workspace,并刷新技能列表

#### Scenario: 用户拖拽或选择有效的文件夹
- **WHEN** 用户将一个包含 SKILL.md(name 字段有效)的本地文件夹拖入拖拽区,或通过选择入口选中该文件夹
- **THEN** 系统直接读取文件夹内的 SKILL.md(无需解压),推导 slug,将文件夹原子化落位到 ~/.stoclaw/openclaw/skills/<slug>/,写入 .stoclaw-user-upload.json 标记,同步到用户 workspace,并刷新技能列表

#### Scenario: 用户上传不含 SKILL.md 的 ZIP 或文件夹
- **WHEN** 用户选择/拖拽的 ZIP(根目录和单层嵌套目录中均未找到)或文件夹中不含 SKILL.md
- **THEN** 系统返回错误提示"未找到 SKILL.md",不安装任何内容

#### Scenario: 用户上传 SKILL.md 缺少 name 或 description
- **WHEN** 用户选择/拖拽的 ZIP 或文件夹,其 SKILL.md frontmatter 中缺少 `name` 或 `description` 字段
- **THEN** 系统返回错误提示"SKILL.md 缺少 name/description 字段",不安装任何内容

#### Scenario: SKILL.md 格式校验占位
- **WHEN** 系统在解压/读取后调用 SKILL.md 格式校验方法
- **THEN** 系统执行预留的 `validateSkillPackage` 占位检查,当前阶段仅做基本存在性检查(具体校验规则待产品确认后补充)

#### Scenario: 上传技能与已有技能 slug 冲突
- **WHEN** 用户上传的 ZIP/文件夹中 SKILL.md name 解析出的 slug 在技能目录中已存在
- **THEN** 系统使用 rename-with-backup 原子化覆盖已有技能目录,旧版本备份保留直到清理

### Requirement: 上传技能归类为"其他"
系统 SHALL 将带有 .stoclaw-user-upload.json 标记文件的技能归类到技能广场的"其他"分类(slug 为 qita)。此分类优先级 SHALL 低于办公技能(pdf/xlsx/docx/pptx)和预装技能(.stoclaw-preinstalled.json),但高于 plaza 远端 / SKILL.md category 兜底。

#### Scenario: 上传的非办公技能出现在"其他"分类
- **WHEN** 技能目录中存在带 .stoclaw-user-upload.json 标记的技能,且其 slug 不在办公白名单中
- **THEN** 技能广场将其显示在"其他"分类下,categoryCode 为 "qita"

#### Scenario: 上传的办公技能归类为"办公"
- **WHEN** 带 .stoclaw-user-upload.json 标记的技能 slug 命中办公白名单(pdf/xlsx/docx/pptx)
- **THEN** 技能广场将其显示在"办公"分类下,因为办公白名单优先级高于用户上传标记

### Requirement: 上传 API 端点
系统 SHALL 提供 POST /api/skill-plaza/upload 端点,接收 JSON body 中的 filePath 字段(指向本地 .zip 文件或文件夹)。端点 SHALL 根据路径类型处理(ZIP 先解压、文件夹直读)、从 SKILL.md frontmatter 推导 slug、安装技能,并返回结果 slug。

#### Scenario: 通过 API 成功上传 ZIP 文件
- **WHEN** 向 /api/skill-plaza/upload 发送 POST 请求,filePath 指向包含有效技能的 ZIP 文件
- **THEN** 系统返回 { success: true, slug: "<推导出的slug>" }

#### Scenario: 通过 API 成功上传文件夹
- **WHEN** 向 /api/skill-plaza/upload 发送 POST 请求,filePath 指向包含有效技能的本地文件夹
- **THEN** 系统直接读取文件夹(不解压),返回 { success: true, slug: "<推导出的slug>" }

#### Scenario: 上传缺少 filePath
- **WHEN** 向 /api/skill-plaza/upload 发送 POST 请求,但 body 中没有 filePath 字段
- **THEN** 系统返回 { success: false, error: "Missing filePath" },状态码 400

#### Scenario: 上传路径不存在
- **WHEN** 向 /api/skill-plaza/upload 发送 POST 请求,filePath 指向的路径在磁盘上不存在
- **THEN** 系统返回 { success: false, error: "Path not found: <path>" },状态码 400

### Requirement: 技能广场工具栏上传按钮
技能广场页面头部 SHALL 显示"上传技能"按钮,点击后弹出应用内"上传技能"模态弹窗。弹窗 SHALL 提供拖拽区(接受文件夹与 .zip 文件)、选择文件/文件夹入口、选择/拖拽后的预览确认步骤、上传中加载状态,以及上传成功后的"上传成功"结果卡片(含技能图标、技能名称、"其他"分类标签及"查看技能"操作)。按钮 SHALL 使用与现有设计一致的图标。用户关闭弹窗后 SHALL 刷新技能列表。

#### Scenario: 用户点击上传按钮
- **WHEN** 用户点击技能广场页面头部的"上传技能"按钮
- **THEN** 弹出应用内"上传技能"模态弹窗,提供拖拽区与"选择文件/文件夹"入口

#### Scenario: 拖拽文件或文件夹到弹窗
- **WHEN** 用户将一个本地 .zip 文件或文件夹拖入弹窗拖拽区
- **THEN** 弹窗进入预览确认步骤,展示所拖入项的路径/名称,并提供"确认上传"与"重新选择"操作;未确认前不开始上传

#### Scenario: 选择文件或文件夹后预览确认
- **WHEN** 用户在弹窗内通过文件选择对话框选中一个本地 .zip 文件或文件夹
- **THEN** 弹窗进入预览确认步骤,展示所选路径/名称,并提供"确认上传"与"重新选择"操作;未确认前不开始上传

#### Scenario: 上传进行中
- **WHEN** 用户确认上传后正在处理
- **THEN** 弹窗显示上传中加载状态,禁用重复操作,直到处理完成

#### Scenario: 上传成功并展示成功卡片
- **WHEN** 上传操作成功完成
- **THEN** 弹窗内展示"上传成功"结果卡片(含技能图标、技能名称、"其他"分类标签及"查看技能"操作);用户关闭弹窗后,技能广场刷新本地技能列表,新上传的技能立即出现

#### Scenario: 上传失败展示错误提示
- **WHEN** 上传操作失败(如未找到 SKILL.md、缺少 name 字段、路径不存在等)
- **THEN** 弹窗内展示上传失败的错误提示,不刷新技能列表,用户可在弹窗内重新拖拽或选择
