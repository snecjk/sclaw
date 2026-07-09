## 1. 后端:技能上传 Service 方法

- [x] 1.1 在 electron/services/sto-skill-service.ts 新增 USER_UPLOAD_MARKER_NAME 常量、validateSkillPackage 占位校验方法和 uploadZip(filePath) 方法:解压 ZIP、调用占位校验、从 SKILL.md frontmatter name 读取 slug、原子化落位到 skills 目录、写入 .stoclaw-user-upload.json 标记(Requirement: 从本地 ZIP 文件或文件夹上传技能)
- [x] 1.2 在 electron/api/routes/skill-plaza.ts 新增 POST /api/skill-plaza/upload 路由,接收 { filePath } JSON body,调用 stoSkillService 上传方法(Requirement: 上传 API 端点)
- [x] 1.3 扩展后端上传支持文件夹输入:检测 filePath 类型(文件 → 解压 ZIP / 文件夹 → 直读 SKILL.md),统一推导 slug、原子化落位、写标记(Requirement: 从本地 ZIP 文件或文件夹上传技能)

## 2. 后端:分类逻辑

- [x] 2.1 在 electron/services/skill-plaza-service.ts 新增 isUserUploadedSkill(skillDir) 辅助函数,在 getLocalSkills 分类优先级中新增 .stoclaw-user-upload.json 标记检测 → 归到"其他"(Requirement: 上传技能归类为"其他")

## 3. 后端:IPC 代理超时

- [x] 3.1 在 electron/main/ipc/host-api-proxy.ts 的 SKILL_INSTALL_PATHS 中添加 /api/skill-plaza/upload,给予扩展超时(Requirement: 上传 API 端点)

## 4. 前端:API 客户端和 Store

- [x] 4.1 在 src/lib/skill-plaza-api.ts 新增 uploadSkillZip(filePath) 函数,通过 hostApiFetch POST 到 /api/skill-plaza/upload(Requirement: 上传 API 端点)
- [x] 4.2 在 src/stores/skill-plaza.ts 新增 uploadSkill action:调用 uploadSkillZip、处理加载状态、成功后刷新本地技能列表(Requirement: 技能广场工具栏上传按钮)

## 5. 前端:上传按钮与弹窗 UI

- [x] 5.1 在 src/components/skill-plaza/SkillPlazaHeader.tsx 新增"上传技能"按钮:点击打开 SkillUploadModal 弹窗、调用 uploadSkill store action、按上传状态切换弹窗内容(Requirement: 技能广场工具栏上传按钮)
- [x] 5.2 新增 src/components/skill-plaza/SkillUploadModal.tsx 上传弹窗:拖拽区(接受本地文件夹与 .zip 文件)+ dialog:open 选择文件/文件夹(openFile+openDirectory)、上传中加载态、上传失败错误提示可重选、关闭后刷新技能列表(Requirement: 技能广场工具栏上传按钮)
- [x] 5.3 扩展 SkillUploadModal:新增"选择/拖拽后预览确认"步骤(展示所选路径,提供"确认上传"/"重新选择",未确认不上传);将"上传成功"卡片细化为含技能图标、技能名称、"其他"分类标签及"查看技能"操作(Requirement: 技能广场工具栏上传按钮)

## 6. 验证

- [ ] 6.1 运行 pnpm run typecheck 验证无 TypeScript 错误
- [ ] 6.2 运行 pnpm run lint 验证无 ESLint 错误
- [ ] 6.3 手动测试上传 xhs-headphone ZIP 与文件夹,验证技能出现在技能广场"其他"分类中
