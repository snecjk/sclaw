## Why

当前技能广场只支持从 STO 云端市场安装技能,用户无法将自己的技能 ZIP 包或文件夹导入到本地使用。用户打包好的技能(如 xhs-headphone)只能手动拷贝到 `~/.stoclaw/openclaw/skills/` 目录,缺少前端入口,且无法被正确分类展示。需要一个上传入口让用户便捷地导入本地技能(ZIP 文件或文件夹)并自动归到"其他"分类。

## What Changes

- 在技能广场页面头部新增"上传技能"按钮:点击后弹出"上传技能"应用内模态弹窗,弹窗提供拖拽区(支持拖拽本地文件夹或 .zip 文件)与"选择文件/文件夹"入口,用户拖入或选择后进入预览确认步骤(展示所选路径,确认后再上传)、查看上传中状态,上传成功后展示"上传成功"卡片(含技能图标、技能名称、"其他"分类标签及"查看技能"操作),关闭弹窗后刷新技能列表
- 后端新增 `POST /api/skill-plaza/upload` 接口,接收本地路径(filePath 可为 .zip 文件或文件夹):ZIP 文件先解压、文件夹直接读取 SKILL.md,随后统一落位、标记
- 上传的文件夹或 .zip 须包含 SKILL.md(YAML frontmatter 格式,含 `name` 与 `description` 字段);缺少 SKILL.md、name 或 description 时返回明确错误,不安装
- 从 SKILL.md frontmatter 的 `name` 字段提取 slug,作为技能目录名
- 落位到 `~/.stoclaw/openclaw/skills/<slug>/` 并写入 `.stoclaw-user-upload.json` 标记文件
- 技能分类判定新增一条优先级规则:有 `.stoclaw-user-upload.json` 标记的技能归到"其他"分类(slug=`qita`)
- 上传后同步到用户 workspace 目录,与现有预装/市场安装技能保持一致的部署流程

## Capabilities

### New Capabilities
- `skills-zip-upload`: 用户上传本地技能包(ZIP 文件或文件夹)的完整流程,包含前端上传入口(应用内模态弹窗:拖拽/选择文件或文件夹/预览确认/上传中/成功卡片)、后端解压或直读落位、标记文件写入和分类归集

### Modified Capabilities
<!-- 无现有 capability 的 spec 级行为变更,分类逻辑属于实现层面 -->

## Impact

- **后端 API**: `electron/api/routes/skill-plaza.ts` 新增 upload 路由(接收 filePath,可为 .zip 文件或文件夹)
- **后端 Service**: `electron/services/sto-skill-service.ts` 新增上传方法(ZIP 文件解压 / 文件夹直读两种输入),复用现有 `extractZip`、`promoteStagedSkillDir`、`ensureSkillFrontmatter`
- **分类逻辑**: `electron/services/skill-plaza-service.ts` 的 `getLocalSkills` 分类判定新增 `.stoclaw-user-upload.json` 标记检测
- **IPC 代理**: `electron/main/ipc/host-api-proxy.ts` 新增 upload 路径超时配置
- **前端 API**: `src/lib/skill-plaza-api.ts` 新增 `uploadSkillZip` 函数
- **前端 Store**: `src/stores/skill-plaza.ts` 新增 `uploadSkill` action
- **前端 UI**: `src/components/skill-plaza/SkillPlazaHeader.tsx` 新增"上传技能"按钮;`src/components/skill-plaza/SkillUploadModal.tsx` 上传弹窗组件(拖拽区 + 选文件/文件夹/预览确认/上传中/成功卡片/错误态)
- **标记文件**: 新增 `.stoclaw-user-upload.json` 标记(与现有 `.stoclaw-preinstalled.json` 并列,语义独立)
- 不涉及 package.json、lockfile、构建配置变更
