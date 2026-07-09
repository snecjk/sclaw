## Context

技能广场当前支持两种技能安装来源:STO 云端市场(sto-skill-service.install)和预装技能(ensurePreinstalledSkillsInstalled)。两者都不支持用户自行上传本地 ZIP 技能包。

现有分类判定逻辑(skill-plaza-service.getLocalSkills)按三级优先级归类:办公白名单 > 预装标记(.stoclaw-preinstalled.json)> plaza 远端/SKILL.md category。用户上传的技能不属于"预装"语义,但需要在技能广场"其他"分类中展示。

ZIP 解压工具(zip-extract.ts)、原子化落位(promoteStagedSkillDir)、frontmatter 解析(skill-frontmatter.ts)、用户 workspace 同步(user-skill-workspace)等基础设施已就绪,可直接复用。

## Goals / Non-Goals

**Goals:**
- 提供前端上传入口,用户选择本地 ZIP 文件即可导入技能
- 从 SKILL.md frontmatter name 字段自动提取 slug
- 上传的技能归到"其他"分类,与预装技能共用分类标签但标记文件独立
- 复用现有解压、落位、frontmatter 补全、workspace 同步等基础设施

**Non-Goals:**
- 不支持 ZIP 内 ZIP 嵌套解压
- 预留 SKILL.md 格式校验占位方法(具体校验规则待产品确认后补充)
- 不新增独立分类标签(复用现有"其他"分类)
- 不实现技能版本管理/更新检测(上传即覆盖)
- 不修改 package.json 或引入新依赖

## Decisions

### 1. 标记文件:新增 .stoclaw-user-upload.json,不复用 .stoclaw-preinstalled.json

**选择**: 新增独立的 .stoclaw-user-upload.json 标记文件,内容为 { source: "user-upload", slug, uploadedAt }。

**理由**: .stoclaw-preinstalled.json 的语义是"应用打包时预安装的技能",由 ensurePreinstalledSkillsInstalled 在启动时管理。如果给用户上传的技能打这个标记,语义混淆,且预装逻辑的 manifest 驱动循环不会清理这些标记(因为不在 manifest 里),导致标记永远残留。独立标记文件语义清晰,后续可区分"预装"和"用户上传"。

**备选方案**: 复用 .stoclaw-preinstalled.json —— 虽然实现最快(分类逻辑零改动),但语义不精确,且 ensurePreinstalledSkillsInstalled 的 local: true 分支会用 content hash 覆盖同名技能,可能误删用户上传的内容。

### 2. Slug 来源:从 SKILL.md frontmatter name 字段提取

**选择**: 解压后读取 SKILL.md frontmatter,取 name 字段,做小写化 + 非 [a-z0-9-] 字符替换为 - 的规范化,作为目录名和 Gateway 标识。

**理由**: Gateway 要求 skill name 匹配 /^[a-z0-9-]+$/,从 frontmatter name 取值最符合用户预期(用户在 SKILL.md 里写了什么名字,技能就叫什么)。现有 ensureSkillFrontmatter 方法已做同样的规范化。

**备选方案**: 从 ZIP 文件名提取 slug —— 但文件名可能包含中文、空格,且用户可能改文件名,不如 frontmatter name 可靠。

### 3. 上传通道:dialog:open 选文件 + hostApiFetch POST 传文件路径

**选择**: 前端在"上传技能"应用内模态弹窗中,通过 dialog:open IPC 弹文件选择器拿到本地文件路径,再通过 hostApiFetch POST 到 /api/skill-plaza/upload,body 为 { filePath: string },后端从本地路径读取 ZIP。

**理由**: hostApiFetch 走 IPC 代理(hostapi:fetch),只支持 JSON body,不支持 multipart/form-data。Electron 桌面应用中文件在本地,传路径比传文件内容更高效,且避免 base64 编码开销。SkillPlazaHeader 已有直接调 ipcRenderer.invoke 的先例。

**备选方案**: 走 multipart/form-data —— 需要扩展 host-api-proxy.ts 支持二进制 body,改动面大且不必要。

### 4. 分类优先级:在预装标记判定之后加用户上传标记判定

**选择**: getLocalSkills 分类优先级变为四级:办公白名单 > 预装标记 > 用户上传标记 > plaza 远端/SKILL.md category。有 .stoclaw-user-upload.json 标记的非办公技能归到"其他"(slug=qita)。

**理由**: 复用现有"其他"分类标签,前端零改动。标记文件独立,分类逻辑只加一条 else if 分支,改动最小。

**备选方案**: 新增独立分类(如"我的上传")—— 语义最清晰,但需要改分类列表注入逻辑和前端分类导航,改动面大。

## Risks / Trade-offs

- [ZIP 内无 SKILL.md] → 解压后检测 SKILL.md 是否存在(支持根目录或单层嵌套),不存在则返回明确错误提示
- [SKILL.md 无 name 字段] → 返回明确错误"未找到 name 字段",引导用户检查 frontmatter
- [同名技能冲突] → promoteStagedSkillDir 的 force=true 分支做 rename-with-backup,原子化覆盖,失败回滚
- [SKILL.md 格式不合规] → 预留 validateSkillPackage(stagingDir) 占位方法,检查 SKILL.md 是否符合 frontmatter 格式;具体校验规则待产品确认后补充,当前阶段仅做基本存在性检查
- [标记文件残留] → 卸载技能时删除整个目录(含标记文件),与现有卸载逻辑一致
